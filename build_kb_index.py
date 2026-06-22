#!/usr/bin/env python3
"""
规则层: 把 拆书_文本/ 语料分类、去重、导出知识库。
  category : 由目录路径+标题规则推断 (6 类)
  tags     : 标题/路径关键词抽取 [题材, 频道, 写作环节]
  name     : 清洗后的标题
  description : 启发式摘要 (后续 LLM 层会精修)
  content_hash : sha1(归一化正文) 用于去重

输出:
  知识库/kb_index.json   全量目录
  知识库/kb_index.md     可读目录(按 category 分组)
  知识库/_stats.md       分类/标签分布
  知识库/_dedup.json     重复组
  知识库/条目/<category>/<slug>.md   每篇带 frontmatter
"""
from __future__ import annotations
import hashlib, json, re
from pathlib import Path
from collections import Counter, defaultdict

DST = Path("/Users/taowen/project/narratox/拆书_文本").resolve()
KB = Path("/Users/taowen/project/narratox/知识库").resolve()

# ---------- 分类规则 ----------
CASE_FOLDERS = {"短篇拆文33篇", "现实情感31篇", "言情17篇", "悬疑惊悚10篇", "脑洞7篇"}
CASE_TITLE = ["拆文", "拆书", "拆解"]
VOCAB_TITLE = ["词库", "词汇", "素材大全", "素材大典", "热梗", "书单"]
CHAR_TITLE = ["人设", "塑造"]
TEMPLATE_TITLE = ["模板", "公式", "套路", "范例", "示例"]
GUIDE_TITLE = ["须知", "审核", "规避", "规范", "投稿渠道", "创作指南", "基础知识"]
GUIDE_FOLDERS = {"创作须知", "创作指南", "网文基础知识", "浅谈网文教程"}
TEMPLATE_FOLDERS = {"大纲完整模板", "大纲模板", "大纲示例", "大纲范例", "大纲模板（选择顺眼的）",
                    "大纲模板（选择合适自己的", "短篇写作公式11篇"}
METHOD_FOLDERS = {"网文全程篇", "大纲技巧", "大纲教程（小白可看）", "大纲篇", "进阶篇",
                  "短篇写作课22节笔记", "教程11份"}

GENRES = ["言情","玄幻","世情","悬疑","惊悚","脑洞","复仇","追妻","甜宠","虐文","虐",
          "霸总","总裁","重生","穿越","权谋","救赎","娱乐圈","丧尸","古言","都市","历史",
          "仙侠","修真","系统","大女主","病娇","耽美","现言","古言","世情","火葬场",
          "打脸","渣男","虐渣","沙雕","弹幕","银发","世情","霸总"]
STAGES = ["大纲","书名","开篇","开头","黄金三章","情节","对白","人物","人设","爽点",
          "结尾","升华","上架","简介","代入感","矛盾","冲突","悬念","文笔","情绪",
          "立意","节奏","伏笔","导语","期待感","切入点","结构","世界观","描写","性格",
          "相貌","动作","风景","心理","对白","语境","运营","书评","人称"]


def clean_title(stem: str) -> str:
    t = stem
    t = re.sub(r"@.*$", "", t)            # @发疯要拆书日万
    t = re.sub(r"^[\d\W]+", "", t)        # 前导数字/符号
    t = re.sub(r"（下载后打开）", "", t)
    t = t.replace("（", "(").replace("）", ")")
    t = re.sub(r"\s+", "", t)
    return t.strip()[:80] or stem


def infer_category(segs: list[str], title: str) -> str:
    sset = set(segs); t = title
    if sset & CASE_FOLDERS or any(k in t for k in CASE_TITLE):
        # 但"拆书教程/拆文模板"是方法论，不是案例
        if "模板" in t or "教程" in t and "拆" in t and "《" not in t:
            pass
        else:
            return "拆文案例"
    if "描写词汇" in sset or any(k in t for k in VOCAB_TITLE):
        return "词汇素材库"
    if "经典人设26篇" in sset or ("人设" in t and not any(k in t for k in VOCAB_TITLE)):
        return "人设档案"
    if any(k in t for k in TEMPLATE_TITLE) or (sset & TEMPLATE_FOLDERS):
        return "公式模板"
    if any(k in t for k in GUIDE_TITLE) or (sset & GUIDE_FOLDERS):
        return "创作须知"
    return "方法论教程"


def infer_tags(segs: list[str], title: str) -> dict:
    hay = title + " " + "/".join(segs)
    genres = sorted({g for g in GENRES if g in hay})
    stages = sorted({s for s in STAGES if s in hay})
    channel = []
    if "男频" in hay: channel.append("男频")
    if "女频" in hay: channel.append("女频")
    tags = {}
    if genres: tags["题材"] = genres
    if channel: tags["频道"] = channel
    if stages: tags["写作环节"] = stages
    return tags


def strip_header(text: str) -> str:
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if re.fullmatch(r"-{3,}", ln.strip()):
            return "\n".join(lines[i + 1:]).strip()
    return text.strip()


def heuristic_desc(title: str, text: str) -> str:
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.startswith(("#", "〔", "##")):
            continue
        m = re.match(r"^(主题|方法|核心|要点|简介|说明|内容)[：:]\s*(.+)", s)
        if m:
            return m.group(2)[:90]
        if 6 <= len(s) <= 90:
            return s[:90]
    return title[:90]


def content_hash(text: str) -> str:
    norm = re.sub(r"\s+", "", text)
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def slug(name: str, idx: int) -> str:
    s = re.sub(r"[/\\:*?\"<>|]", "_", name).strip()
    s = re.sub(r"\s+", "_", s)
    return (s[:50] or f"item{idx}") + f"_{idx:04d}"


def main():
    man = json.loads((DST / "_manifest.json").read_text(encoding="utf-8"))
    entries = []
    idx = 0
    for r in man:
        if r["status"] != "ok":
            continue
        idx += 1
        rel = r["src"]
        # manifest.out 形如 "拆书_文本/<rel>.txt"，相对项目根 = DST.parent
        out_path = DST.parent / r["out"]
        try:
            raw = out_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            raw = ""
        body = strip_header(raw)
        segs = Path(rel).parts
        name = clean_title(Path(rel).stem)
        cat = infer_category(list(segs), name)
        tags = infer_tags(list(segs), name)
        desc = heuristic_desc(name, body)
        ch = content_hash(body)
        ocr = r["method"].startswith("ocr") or "ocr" in r["method"]
        entries.append({
            "id": f"kb{idx:04d}",
            "name": name,
            "category": cat,
            "tags": tags,
            "description": desc,
            "source": rel,
            "source_method": r["method"],
            "source_ocr": ocr,
            "chars": r["chars"],
            "content_hash": ch,
            "content": body,
        })

    # ---------- 去重 ----------
    by_hash = defaultdict(list)
    for e in entries:
        by_hash[e["content_hash"]].append(e)
    dedup_groups = []
    keep_ids = set()
    for h, group in by_hash.items():
        if len(group) == 1:
            keep_ids.add(group[0]["id"])
        else:
            # 保留: 非ocr 优先，再路径短
            group_sorted = sorted(group, key=lambda e: (e["source_ocr"], len(e["source"]), e["source"]))
            keep_ids.add(group_sorted[0]["id"])
            dedup_groups.append({
                "hash": h,
                "kept": group_sorted[0]["id"],
                "kept_name": group_sorted[0]["name"],
                "duplicates": [{"id": g["id"], "name": g["name"], "source": g["source"]} for g in group_sorted[1:]],
            })
    entries_kept = [e for e in entries if e["id"] in keep_ids]

    # ---------- 导出 ----------
    KB.mkdir(parents=True, exist_ok=True)
    (KB / "条目").mkdir(exist_ok=True)
    # 清空旧条目
    for d in (KB / "条目").iterdir():
        if d.is_dir():
            for f in d.glob("*.md"): f.unlink()

    def write_entry(e):
        cdir = KB / "条目" / e["category"]; cdir.mkdir(parents=True, exist_ok=True)
        md = cdir / f"{slug(e['name'], int(e['id'][2:]))}.md"
        tags_yaml = json.dumps(e["tags"], ensure_ascii=False)
        front = (
            "---\n"
            f"id: {e['id']}\n"
            f"name: {json.dumps(e['name'], ensure_ascii=False)}\n"
            f"category: {e['category']}\n"
            f"tags: {tags_yaml}\n"
            f"description: {json.dumps(e['description'], ensure_ascii=False)}\n"
            f"source: {json.dumps(e['source'], ensure_ascii=False)}\n"
            f"source_method: {e['source_method']}\n"
            f"source_ocr: {str(e['source_ocr']).lower()}\n"
            f"chars: {e['chars']}\n"
            f"content_hash: {e['content_hash']}\n"
            "---\n\n"
        )
        md.write_text(front + (e["content"] or "").strip() + "\n", encoding="utf-8")
        e["md_path"] = str(md.relative_to(KB))

    for e in entries_kept:
        write_entry(e)

    # index json (不含 content，太长；content 在 md 里)
    slim = [{k: v for k, v in e.items() if k != "content"} for e in entries_kept]
    (KB / "kb_index.json").write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
    (KB / "_dedup.json").write_text(json.dumps(dedup_groups, ensure_ascii=False, indent=2), encoding="utf-8")

    # 可读目录
    by_cat = defaultdict(list)
    for e in entries_kept:
        by_cat[e["category"]].append(e)
    lines = ["# 知识库目录\n", f"去重后条目: {len(entries_kept)} / 原成功: {len(entries)} / 重复组: {len(dedup_groups)}\n"]
    for cat in sorted(by_cat):
        lines.append(f"\n## {cat} ({len(by_cat[cat])})\n")
        for e in sorted(by_cat[cat], key=lambda x: -x["chars"]):
            tg_parts = []
            for v in e["tags"].values():
                tg_parts.extend(v if isinstance(v, list) else [v])
            tg = ",".join(tg_parts)
            ocr = " 🔤" if e["source_ocr"] else ""
            lines.append(f"- **{e['name']}**{ocr} [{tg}] — {e['description']}")
    (KB / "kb_index.md").write_text("\n".join(lines), encoding="utf-8")

    # 统计
    cat_c = Counter(e["category"] for e in entries_kept)
    genre_c = Counter(); stage_c = Counter(); chan_c = Counter()
    for e in entries_kept:
        for g in e["tags"].get("题材", []): genre_c[g] += 1
        for s in e["tags"].get("写作环节", []): stage_c[s] += 1
        for c in e["tags"].get("频道", []): chan_c[c] += 1
    ocr_n = sum(1 for e in entries_kept if e["source_ocr"])
    st = ["# 知识库统计\n", f"条目总数: {len(entries_kept)} (OCR 来源 {ocr_n})\n",
          "## 分类\n"]
    st += [f"- {k}: {v}" for k, v in cat_c.most_common()]
    st.append("\n## 题材标签\n"); st += [f"- {k}: {v}" for k, v in genre_c.most_common(25)]
    st.append("\n## 写作环节标签\n"); st += [f"- {k}: {v}" for k, v in stage_c.most_common(25)]
    st.append("\n## 频道\n"); st += [f"- {k}: {v}" for k, v in chan_c.most_common()]
    (KB / "_stats.md").write_text("\n".join(st), encoding="utf-8")

    print(f"完成: 保留 {len(entries_kept)} 条 (去重 {len(entries) - len(entries_kept)})")
    print("分类分布:", dict(cat_c))
    print(f"OCR 来源: {ocr_n}")
    print(f"输出: {KB}")


if __name__ == "__main__":
    main()
