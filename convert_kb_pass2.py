#!/usr/bin/env python3
"""
Pass 2: 处理 Pass 1 标记为 empty/pass2 的文件。
  - 图片型 PDF (整页长截图)  -> 提取内嵌图，长图分段 OCR (tesseract chi_sim)
  - png/jpg                 -> 同上分段 OCR
  - ppt/wps                 -> LibreOffice (soffice --headless --convert-to txt)
  - chm                     -> 尝试 7z/chmlib 解包后抽 HTML 文本，失败则标记
覆盖更新 拆书_文本/ 下对应的 .txt，并重写 _manifest.json / _SUMMARY.md。
"""
from __future__ import annotations
import io, json, os, re, shutil, subprocess, tempfile, zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import fitz
from PIL import Image

SRC = Path("/Users/taowen/project/narratox/2690.小说拆书教程").resolve()
DST = Path("/Users/taowen/project/narratox/拆书_文本").resolve()
SOFFICE = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
CHUNK, OVERLAP = 3000, 200


def safe_rel(p: Path) -> str:
    return str(p.relative_to(SRC))


def out_path_for(src: Path) -> Path:
    return DST / src.relative_to(SRC).with_suffix(".txt")


def wrap(text, src, ext, method, extra=""):
    n = len(text or "")
    h = (f"# 来源: {safe_rel(src)}\n# 格式: {ext} → 文本\n"
         f"# 提取方法: {method}\n# 字符数: {n}\n")
    if extra:
        h += f"# 备注: {extra}\n"
    h += "-" * 40 + "\n"
    return h + (text or "")


def ocr_image(im: Image.Image) -> str:
    """OCR 单张 PIL 图（长图自动分段）。"""
    W, H = im.size
    if H <= CHUNK:
        return _tess(im)
    parts, y = [], 0
    while y < H:
        bottom = min(y + CHUNK, H)
        parts.append(_tess(im.crop((0, y, W, bottom))))
        if bottom >= H:
            break
        y = bottom - OVERLAP
    return "\n".join(s for s in parts if s)


def _tess(im: Image.Image) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name
    try:
        im.save(path)
        r = subprocess.run(["tesseract", path, "stdout", "-l", "chi_sim", "--psm", "6"],
                           capture_output=True)
        return r.stdout.decode("utf-8", "replace").strip()
    finally:
        os.unlink(path)


def ocr_pdf_images(src: Path) -> tuple[str, str]:
    """提取 PDF 每页内嵌图片并 OCR；无内嵌图则整页渲染。"""
    d = fitz.open(src)
    parts, segs = [], 0
    for i, pg in enumerate(d, 1):
        imgs = pg.get_images(full=True)
        chunks = []
        if imgs:
            for xref in (m[0] for m in imgs):
                try:
                    base = d.extract_image(xref)
                    chunks.append(Image.open(io.BytesIO(base["image"])).convert("RGB"))
                except Exception:
                    pass
        if not chunks:
            chunks.append(Image.frombytes("RGB", [pg.rect.width, pg.rect.height],
                                         pg.get_pixmap(dpi=200).samples))
        for im in chunks:
            parts.append(ocr_image(im))
            segs += 1
    d.close()
    return "\n\n".join(s for s in parts if s), f"{segs} 段 OCR"


def ocr_plain_image(src: Path) -> tuple[str, str]:
    im = Image.open(src).convert("RGB")
    W, H = im.size
    note = f"{H}px 高" + ("（分段）" if H > CHUNK else "")
    return ocr_image(im), note


def convert_one_ocr(src_str: str) -> dict:
    src = Path(src_str)
    ext = src.suffix.lower()
    out = out_path_for(src)
    rec = {"src": safe_rel(src), "ext": ext, "out": str(out.relative_to(DST.parent)),
           "status": "ok", "method": "", "chars": 0, "note": ""}
    try:
        if ext == ".pdf":
            text, note = ocr_pdf_images(src); rec["method"] = "ocr:tesseract(chi_sim)"
        elif ext in (".png", ".jpg", ".jpeg"):
            text, note = ocr_plain_image(src); rec["method"] = "ocr:tesseract(chi_sim)"
        else:
            return rec
        text = (text or "").strip()
        rec["note"] = note
        if not text:
            rec["status"] = "empty"
        else:
            rec["chars"] = len(text)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(wrap(text, src, ext, rec["method"], note), encoding="utf-8")
    except Exception as e:
        rec["status"] = "failed"
        rec["note"] = f"{type(e).__name__}: {str(e)[:160]}"
    return rec


def libreoffice_batch(files: list[Path]) -> dict:
    """一次性把 ppt/wps 转 txt 到临时目录，再搬回镜像位置。"""
    results = {}
    if not files:
        return results
    with tempfile.TemporaryDirectory() as td:
        cmd = [SOFFICE, "--headless", "--convert-to", "txt:Text (encoded):UTF8",
               "--outdir", td] + [str(f) for f in files]
        env = dict(os.environ, HOME=os.environ.get("HOME", "/tmp"))
        r = subprocess.run(cmd, capture_output=True, env=env, timeout=600)
        for f in files:
            txt = Path(td) / (f.stem + ".txt")
            src = f
            out = out_path_for(src)
            rec = {"src": safe_rel(src), "ext": src.suffix.lower(),
                   "out": str(out.relative_to(DST.parent)),
                   "status": "ok", "method": "libreoffice", "chars": 0, "note": ""}
            if txt.exists():
                text = txt.read_text(encoding="utf-8", errors="replace").strip()
                if not text:
                    rec["status"] = "empty"; rec["note"] = "转换后为空"
                else:
                    rec["chars"] = len(text)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(wrap(text, src, src.suffix.lower(), "libreoffice", rec["note"]),
                               encoding="utf-8")
            else:
                rec["status"] = "failed"; rec["note"] = "soffice 未产出文件"
            results[str(src)] = rec
    return results


def convert_chm(src: Path) -> dict:
    out = out_path_for(src)
    rec = {"src": safe_rel(src), "ext": ".chm", "out": str(out.relative_to(DST.parent)),
           "status": "ok", "method": "", "chars": 0, "note": ""}
    with tempfile.TemporaryDirectory() as td:
        # 试 7z / extract_chmLib
        dumped = False
        for tool in (["7z", "x", "-y", "-o", td, str(src)],
                     ["extract_chmLib", str(src), td]):
            if shutil.which(tool[0]):
                r = subprocess.run(tool, capture_output=True)
                if r.returncode == 0 and any(Path(td).iterdir()):
                    dumped = True; rec["method"] = f"unpack:{tool[0]}"; break
        if not dumped:
            rec["status"] = "pass2"; rec["method"] = "NEED:chmlib/7z"
            rec["note"] = "无 7z/chmlib，需手动处理"
            return rec
        # 收集 HTML 文本
        texts = []
        for htm in Path(td).rglob("*.htm*"):
            try:
                raw = htm.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            t = re.sub(r"<[^>]+>", " ", raw)
            t = re.sub(r"&[a-zA-Z#0-9]+;", " ", t)
            t = re.sub(r"\s+", " ", t).strip()
            if len(t) > 30:
                texts.append(t)
        text = "\n\n".join(texts)
        if not text:
            rec["status"] = "empty"; rec["note"] = "解包后无可用文本"
        else:
            rec["chars"] = len(text)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(wrap(text, src, ".chm", rec["method"] or "unpack", rec["note"]),
                       encoding="utf-8")
    return rec


def main():
    man = json.loads((DST / "_manifest.json").read_text(encoding="utf-8"))
    todo_ocr, todo_lo, todo_chm = [], [], []
    for r in man:
        if r["status"] in ("empty", "pass2"):
            src = SRC / r["src"]
            ext = r["ext"]
            if ext == ".pdf" or ext in (".png", ".jpg", ".jpeg"):
                todo_ocr.append(src)
            elif ext in (".ppt", ".pptx", ".wps"):
                todo_lo.append(src)
            elif ext == ".chm":
                todo_chm.append(src)

    print(f"Pass2 待处理: OCR {len(todo_ocr)} | LibreOffice {len(todo_lo)} | CHM {len(todo_chm)}")

    updates = {}  # src -> rec
    # 1) OCR 并行
    if todo_ocr:
        with ProcessPoolExecutor(max_workers=6) as ex:
            futs = {ex.submit(convert_one_ocr, str(s)): s for s in todo_ocr}
            done = 0
            for fut in as_completed(futs):
                rec = fut.result(); updates[rec["src"]] = rec; done += 1
                if done % 20 == 0 or done == len(todo_ocr):
                    print(f"  OCR 进度 {done}/{len(todo_ocr)}")
    # 2) LibreOffice 一次性
    if todo_lo:
        print(f"  LibreOffice 转换 {len(todo_lo)} 个 ...")
        updates.update({v["src"]: v for v in libreoffice_batch(todo_lo).values()})
    # 3) CHM
    if todo_chm:
        for s in todo_chm:
            rec = convert_chm(s); updates[rec["src"]] = rec

    # 合并回 manifest
    for r in man:
        if r["src"] in updates:
            u = updates[r["src"]]
            r["status"] = u["status"]; r["method"] = u["method"]
            r["chars"] = u["chars"]; r["note"] = u["note"]
    man.sort(key=lambda r: r["src"])
    (DST / "_manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=2),
                                        encoding="utf-8")
    write_summary(man)
    from collections import Counter
    by = Counter(r["status"] for r in man)
    print(f"\nPass2 完成。当前状态: {dict(by)}")


def write_summary(man):
    from collections import Counter
    by_status = Counter(r["status"] for r in man)
    by_ext = Counter(r["ext"] for r in man)
    by_method = Counter(r["method"].split(":")[0].split("(")[0] for r in man if r["status"] == "ok")
    ok = [r for r in man if r["status"] == "ok"]
    empty = [r for r in man if r["status"] == "empty"]
    failed = [r for r in man if r["status"] == "failed"]
    pass2 = [r for r in man if r["status"] == "pass2"]
    total = sum(r["chars"] for r in man)
    lines = [
        "# 拆书文本 语料统计 (Pass1 + Pass2)\n",
        f"- 文件总数: {len(man)}",
        f"- 成功提取: {len(ok)}",
        f"- 提取为空: {len(empty)}",
        f"- 失败: {len(failed)}",
        f"- 仍待处理: {len(pass2)}",
        f"- 总字符数: {total:,}\n",
        "## 按状态\n",
    ]
    lines += [f"- {k}: {v}" for k, v in by_status.most_common()]
    lines.append("\n## 按扩展名\n")
    lines += [f"- {k}: {v}" for k, v in by_ext.most_common()]
    lines.append("\n## 成功项按提取方法\n")
    lines += [f"- {k}: {v}" for k, v in by_method.most_common()]
    for label, bucket in [("提取为空", empty), ("失败", failed), ("仍待处理", pass2)]:
        if bucket:
            lines.append(f"\n## {label}\n")
            lines += [f"- `{r['src']}` ({r['ext']}) {r['note']}" for r in bucket[:80]]
    (DST / "_SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
