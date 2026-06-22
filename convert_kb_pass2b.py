#!/usr/bin/env python3
"""
Pass 2.5: 修复 Pass2 遗留。
  - 24 个 .ppt  -> 逐个 soffice -> pdf (避免同名撞名 + txt 滤镜对老 ppt 无效) -> pymupdf 抽文 + OCR 图页
  - 2 个图片型 .doc (古代女子的发鬓与服饰) -> soffice -> pdf -> OCR
  - 3 个 .chm -> extract_chmLib 解包 -> 抽 HTML 文本
合并回 _manifest.json / _SUMMARY.md。
"""
from __future__ import annotations
import json, os, re, shutil, subprocess, tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
import fitz

from convert_kb_pass2 import (SRC, DST, SOFFICE, ocr_image, wrap,
                              out_path_for, safe_rel, write_summary, convert_chm)


def soffice_to_pdf(src: Path, outdir: Path) -> Path | None:
    """单文件 soffice -> pdf，独立 outdir 避免撞名。返回生成的 pdf 路径。"""
    cmd = [SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(src)]
    env = dict(os.environ, HOME=os.environ.get("HOME", "/tmp"))
    try:
        subprocess.run(cmd, capture_output=True, env=env, timeout=180)
    except subprocess.TimeoutExpired:
        return None
    pdf = outdir / (src.stem + ".pdf")
    return pdf if pdf.exists() else None


def pdf_to_text(pdf: Path) -> tuple[str, str]:
    """抽 PDF 文本；每页文字 <20 字则渲染 OCR。"""
    d = fitz.open(pdf)
    parts, ocr_pages = [], 0
    for i, pg in enumerate(d, 1):
        t = pg.get_text().strip()
        if len(t) >= 20:
            parts.append(t)
        else:
            pix = pg.get_pixmap(dpi=200)
            from PIL import Image
            im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            otxt = ocr_image(im)
            if otxt:
                parts.append(otxt); ocr_pages += 1
            elif t:
                parts.append(t)
    d.close()
    note = f"OCR 图页 {ocr_pages}" if ocr_pages else ""
    return "\n\n".join(parts), note


def handle_office_pdf(src_str: str, kind: str) -> dict:
    src = Path(src_str); out = out_path_for(src)
    rec = {"src": safe_rel(src), "ext": src.suffix.lower(),
           "out": str(out.relative_to(DST.parent)), "status": "ok",
           "method": f"libreoffice+{'ocr' if kind=='doc' else 'pymupdf'}", "chars": 0, "note": ""}
    with tempfile.TemporaryDirectory() as td:
        pdf = soffice_to_pdf(src, Path(td))
        if not pdf:
            rec["status"] = "failed"; rec["note"] = "soffice 未产出 pdf"; return rec
        text, note = pdf_to_text(pdf)
    text = (text or "").strip()
    if not text:
        rec["status"] = "empty"; rec["note"] = "pdf 抽文为空"
    else:
        rec["chars"] = len(text); rec["note"] = note
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(wrap(text, src, src.suffix.lower(), rec["method"], note), encoding="utf-8")
    return rec


def main():
    man = json.loads((DST / "_manifest.json").read_text(encoding="utf-8"))
    todo_ppt, todo_docimg, todo_chm = [], [], []
    for r in man:
        if r["status"] not in ("failed", "empty", "pass2"):
            continue
        src = SRC / r["src"]; ext = r["ext"]
        if ext == ".ppt":
            todo_ppt.append(str(src))
        elif ext == ".doc" and r["status"] == "empty":
            todo_docimg.append(str(src))
        elif ext == ".chm":
            todo_chm.append(src)
    print(f"Pass2.5 待修复: ppt {len(todo_ppt)} | 图片doc {len(todo_docimg)} | chm {len(todo_chm)}")

    updates = {}
    # soffice 调用必须串行（headless 锁）
    for i, s in enumerate(todo_ppt + todo_docimg, 1):
        kind = "doc" if s in todo_docimg else "ppt"
        rec = handle_office_pdf(s, kind)
        updates[rec["src"]] = rec
        print(f"  [{i}/{len(todo_ppt)+len(todo_docimg)}] {rec['status']:6} {rec['chars']:>6}字  {Path(s).name[:40]}")
    # chm（chmlib 已装）
    for s in todo_chm:
        rec = convert_chm(s); updates[rec["src"]] = rec
        print(f"  chm: {rec['status']:6} {rec['chars']:>6}字  {s.name[:40]}")

    for r in man:
        if r["src"] in updates:
            u = updates[r["src"]]
            r.update({"status": u["status"], "method": u["method"],
                      "chars": u["chars"], "note": u["note"]})
    man.sort(key=lambda r: r["src"])
    (DST / "_manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
    write_summary(man)
    from collections import Counter
    print("\nPass2.5 完成。状态:", dict(Counter(r["status"] for r in man)))


if __name__ == "__main__":
    main()
