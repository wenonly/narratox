#!/usr/bin/env python3
"""
批量把 2690.小说拆书教程/ 下的文档转成纯文本，镜像目录结构输出到 拆书_文本/。

每个输出文件带一个来源元数据头（路径/格式/方法/字符数），方便后续灌知识库。
同时写 _manifest.json（逐文件结果）和 _SUMMARY.md（统计）。

覆盖格式（Pass 1，纯轻量依赖）:
  doc/docx/rtf/html/odt  -> textutil
  txt                    -> 直接读
  pdf                    -> pymupdf (fitz)
  xlsx                   -> openpyxl
  xls                    -> xlrd
  xmind                  -> unzip + 解析 content.json/xml

标记为 PASS2（需 LibreOffice / OCR，本脚本不处理，只写占位说明）:
  ppt / wps / chm        -> 需 LibreOffice (soffice --headless)
  png / jpg              -> 需 OCR (tesseract chi_sim) 或视觉模型
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import fitz  # pymupdf
import openpyxl
import xlrd

SRC = Path("/Users/taowen/project/narratox/2690.小说拆书教程").resolve()
DST = Path("/Users/taowen/project/narratox/拆书_文本").resolve()

TEXTUTIL_EXTS = {".doc", ".docx", ".rtf", ".html", ".htm", ".odt", ".webarchive", ".wordml"}
PASS2_EXTS = {".ppt", ".pptx", ".wps", ".chm", ".png", ".jpg", ".jpeg", ".gif", ".bmp"}


def safe_rel(p: Path) -> str:
    return str(p.relative_to(SRC))


def out_path_for(src: Path) -> Path:
    rel = src.relative_to(SRC)
    out = DST / rel.with_suffix(".txt")
    return out


def wrap(text: str, src: Path, ext: str, method: str, extra: str = "") -> str:
    n = len(text) if text else 0
    header = (
        f"# 来源: {safe_rel(src)}\n"
        f"# 格式: {ext} → 文本\n"
        f"# 提取方法: {method}\n"
        f"# 字符数: {n}\n"
    )
    if extra:
        header += f"# 备注: {extra}\n"
    header += "-" * 40 + "\n"
    return header + (text or "")


def via_textutil(src: Path) -> tuple[str, str]:
    # -encoding UTF-8 forces utf-8 on stdout
    r = subprocess.run(
        ["textutil", "-convert", "txt", "-encoding", "UTF-8", "-stdout", str(src)],
        capture_output=True,
    )
    text = r.stdout.decode("utf-8", errors="replace").strip()
    note = ""
    if r.returncode != 0:
        note = f"textutil rc={r.returncode}: {r.stderr.decode('utf-8','replace')[:120]}"
    return text, note


def via_pdf(src: Path) -> tuple[str, str]:
    d = fitz.open(src)
    parts = []
    scanned_pages = 0
    for i, pg in enumerate(d, 1):
        t = pg.get_text().strip()
        if len(t) < 20:
            # might be a scanned/image-only page
            scanned_pages += 1
            if t:
                parts.append(f"〔第{i}页〕\n{t}")
        else:
            parts.append(f"〔第{i}页〕\n{t}")
    d.close()
    note = f"疑似扫描/图片页 {scanned_pages} 页" if scanned_pages else ""
    return "\n\n".join(parts), note


def via_xlsx(src: Path) -> tuple[str, str]:
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"## 工作表: {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c.strip() for c in cells):
                out.append("\t".join(cells))
    wb.close()
    return "\n".join(out), ""


def via_xls(src: Path) -> tuple[str, str]:
    wb = xlrd.open_workbook(str(src))
    out = []
    for sh in wb.sheets():
        out.append(f"## 工作表: {sh.name}")
        for r in range(sh.nrows):
            cells = ["" if c is None else str(c) for c in sh.row_values(r)]
            if any(c.strip() for c in cells):
                out.append("\t".join(cells))
    return "\n".join(out), ""


def via_xmind(src: Path) -> tuple[str, str]:
    out = []
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        # newer xmind -> content.json ; older -> content.xml
        if "content.json" in names:
            data = z.read("content.json").decode("utf-8", errors="replace")
            try:
                obj = json.loads(data)
                _walk_xmind_json(obj, out)
            except json.JSONDecodeError:
                out.append(data)
        elif "content.xml" in names:
            import re
            xml = z.read("content.xml").decode("utf-8", errors="replace")
            titles = re.findall(r"<title>(.*?)</title>", xml, re.S)
            out.extend(t.strip() for t in titles if t.strip())
        else:
            return "", f"未知 xmind 结构: {names[:5]}"
    return "\n".join(out), ""


def _walk_xmind_json(node, out: list, depth=0):
    if isinstance(node, dict):
        title = node.get("title")
        if title:
            out.append("  " * depth + str(title))
        for key in ("children", "topics", "attached"):
            ch = node.get(key)
            if isinstance(ch, dict):
                # children often wrapped as {"attached": [...]}
                for k in ("attached", "detached", "summary"):
                    if k in ch and isinstance(ch[k], list):
                        for c in ch[k]:
                            _walk_xmind_json(c, out, depth + 1)
            elif isinstance(ch, list):
                for c in ch:
                    _walk_xmind_json(c, out, depth + 1)
    elif isinstance(node, list):
        for c in node:
            _walk_xmind_json(c, out, depth)


def via_txt(src: Path) -> tuple[str, str]:
    for enc in ("utf-8", "gb18030", "utf-16"):
        try:
            return src.read_text(encoding=enc).strip(), ""
        except (UnicodeDecodeError, OSError):
            continue
    return "", "无法解码文本"


def convert_one(src_str: str) -> dict:
    src = Path(src_str)
    ext = src.suffix.lower()
    out = out_path_for(src)
    rec = {
        "src": safe_rel(src),
        "ext": ext,
        "out": str(out.relative_to(DST.parent)),
        "status": "ok",
        "method": "",
        "chars": 0,
        "note": "",
    }
    try:
        if ext == ".txt":
            text, note = via_txt(src); rec["method"] = "direct"
        elif ext in TEXTUTIL_EXTS:
            text, note = via_textutil(src); rec["method"] = "textutil"
        elif ext == ".pdf":
            text, note = via_pdf(src); rec["method"] = "pymupdf"
        elif ext == ".xlsx":
            text, note = via_xlsx(src); rec["method"] = "openpyxl"
        elif ext == ".xls":
            text, note = via_xls(src); rec["method"] = "xlrd"
        elif ext == ".xmind":
            text, note = via_xmind(src); rec["method"] = "unzip+xmind"
        elif ext in PASS2_EXTS:
            # placeholder, don't extract now
            need = "LibreOffice(soffice)" if ext in (".ppt", ".pptx", ".wps", ".chm") else "OCR(tesseract chi_sim)或视觉模型"
            text = ""
            rec["status"] = "pass2"
            rec["method"] = f"NEED:{need}"
            rec["note"] = f"待 Pass2 处理 ({need})"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(
                wrap(f"[待处理] 此文件为 {ext}，需 {need}。\n来源: {safe_rel(src)}", src, ext, rec["method"], rec["note"]),
                encoding="utf-8",
            )
            rec["chars"] = 0
            return rec
        else:
            text = ""
            rec["status"] = "skip"
            rec["method"] = "unknown"
            rec["note"] = f"未识别扩展名 {ext}"
            return rec

        text = (text or "").strip()
        if not text and ext != ".txt":
            rec["status"] = "empty"
            rec["note"] = note or "提取为空（可能是扫描件/空文档）"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(wrap(text, src, ext, rec["method"], note), encoding="utf-8")
        rec["chars"] = len(text)
        rec["note"] = note
    except Exception as e:
        rec["status"] = "failed"
        rec["method"] = rec.get("method") or ext
        rec["note"] = f"{type(e).__name__}: {str(e)[:160]}"
    return rec


def main():
    files = [p for p in SRC.rglob("*") if p.is_file() and p.name != ".DS_Store"]
    print(f"扫描到 {len(files)} 个文件，开始转换 → {DST}")
    results = []
    with ProcessPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(convert_one, str(p)): p for p in files}
        done = 0
        for fut in as_completed(futs):
            rec = fut.result()
            results.append(rec)
            done += 1
            if done % 100 == 0 or done == len(files):
                print(f"  进度 {done}/{len(files)}")

    # manifest
    DST.mkdir(parents=True, exist_ok=True)
    results.sort(key=lambda r: r["src"])
    (DST / "_manifest.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # summary
    from collections import Counter
    by_status = Counter(r["status"] for r in results)
    by_ext = Counter(r["ext"] for r in results)
    ok = [r for r in results if r["status"] == "ok"]
    empty = [r for r in results if r["status"] == "empty"]
    failed = [r for r in results if r["status"] == "failed"]
    pass2 = [r for r in results if r["status"] == "pass2"]
    total_chars = sum(r["chars"] for r in results)

    lines = [
        "# 拆书文本 语料统计\n",
        f"- 源目录: `{SRC}`",
        f"- 输出目录: `{DST}`",
        f"- 文件总数: {len(results)}",
        f"- 成功提取: {len(ok)}",
        f"- 提取为空(疑似扫描/空): {len(empty)}",
        f"- 失败: {len(failed)}",
        f"- 待 Pass2 (LibreOffice/OCR): {len(pass2)}",
        f"- 总字符数: {total_chars:,}\n",
        "## 按状态\n",
    ]
    for k, v in by_status.most_common():
        lines.append(f"- {k}: {v}")
    lines.append("\n## 按扩展名\n")
    for k, v in by_ext.most_common():
        lines.append(f"- {k}: {v}")
    if empty:
        lines.append("\n## 提取为空（需检查是否扫描件）\n")
        for r in empty[:50]:
            lines.append(f"- `{r['src']}` ({r['ext']}) {r['note']}")
    if failed:
        lines.append("\n## 失败\n")
        for r in failed:
            lines.append(f"- `{r['src']}` ({r['ext']}) {r['note']}")
    if pass2:
        lines.append("\n## 待 Pass2（LibreOffice / OCR）\n")
        from collections import Counter as C
        for ext, n in C(r["ext"] for r in pass2).most_common():
            lines.append(f"- {ext}: {n} 个")

    (DST / "_SUMMARY.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n完成。成功 {len(ok)} / 空 {len(empty)} / 失败 {len(failed)} / 待Pass2 {len(pass2)}")
    print(f"总字符 {total_chars:,}，明细见 {DST/'_SUMMARY.md'}")


if __name__ == "__main__":
    main()
