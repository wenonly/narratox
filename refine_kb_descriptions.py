#!/usr/bin/env python3
"""
LLM 描述精修层: 用 GLM-4-flash 批量为每条知识库条目生成一句话 description,
并从正文补充题材关键词。读取 知识库/kb_index.json + 条目/*.md,就地更新 frontmatter。
失败则保留规则层启发式 description。
"""
from __future__ import annotations
import json, re, time, urllib.request, urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

KB = Path("/Users/taowen/project/narratox/知识库").resolve()
MODEL = "glm-4-flash"
BASE = "https://open.bigmodel.cn/api/paas/v4"
BATCH = 12
WORKERS = 5
GENRE_VOCAB = ("言情 玄幻 世情 悬疑 惊悚 脑洞 复仇 追妻 甜宠 虐文 霸总 总裁 重生 穿越 "
               "权谋 救赎 娱乐圈 丧尸 古言 都市 历史 仙侠 修真 系统 大女主 病娇 耽美 现言 "
               "火葬场 打脸 渣男 沙雕 弹幕 银发 灵异 科幻 武侠 同人 豪门 契约 军旅 谍战 "
               "推理 悬爱 师生 古风 现代言情 架空 种田 病娇 逆袭")


def load_key():
    for ln in open("/Users/taowen/project/narratox/server/.env", encoding="utf-8"):
        m = re.match(r'\s*ZHIPUAI_API_KEY\s*=\s*["\']?([^"\'\r\n]+)', ln)
        if m:
            return m.group(1).strip()
    raise RuntimeError("ZHIPUAI_API_KEY not found in server/.env")


def parse_md(path: Path) -> tuple[dict, str]:
    txt = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", txt, re.S)
    if not m:
        return {}, txt
    fm, body = m.group(1), m.group(2)
    meta = {}
    for line in fm.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body


def write_md(path: Path, meta: dict, body: str):
    # 保留字段顺序
    order = ["id", "name", "category", "tags", "description", "source",
             "source_method", "source_ocr", "chars", "content_hash"]
    lines = ["---"]
    for k in order:
        if k in meta:
            lines.append(f"{k}: {meta[k]}")
    # 额外字段
    for k, v in meta.items():
        if k not in order:
            lines.append(f"{k}: {v}")
    lines.append("---")
    path.write_text("\n".join(lines) + "\n\n" + body.lstrip() + "\n", encoding="utf-8")


def call_glm(batch: list[dict], key: str) -> list[dict]:
    prompt = (
        "你是网文写作知识库的编目助手。下面是若干条目的(id/标题/分类/正文摘录)。"
        "请为每条输出:\n"
        "1) description: 一句话客观摘要(中文,<=45字,说明这条知识教什么/是什么案例/收录了什么)\n"
        "2) genres: 从正文判断的题材关键词数组,只能从这个词表里选,没有就给空数组: "
        + f"[{GENRE_VOCAB}]\n"
        "只返回JSON数组(不要markdown代码块、不要解释),每个元素 {id, description, genres}。\n条目:\n"
        + json.dumps(batch, ensure_ascii=False))
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2, "max_tokens": 1500,
    }).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                resp = json.loads(r.read())
            content = resp["choices"][0]["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
            return json.loads(content)
        except (urllib.error.URLError, json.JSONDecodeError, KeyError, TimeoutError) as e:
            last = e; time.sleep(2 + attempt * 2)
    print(f"  ! 批次失败: {last}")
    return []


def main():
    key = load_key()
    idx = json.loads((KB / "kb_index.json").read_text(encoding="utf-8"))
    # 读每条 md 的 body 摘录
    tasks = []
    for e in idx:
        md = KB / e["md_path"]
        meta, body = parse_md(md)
        excerpt = re.sub(r"\s+", " ", body).strip()[:600]
        tasks.append({"id": e["id"], "name": e["name"], "category": e["category"],
                      "excerpt": excerpt, "_md": str(md), "_idx": e})
    batches = [tasks[i:i + BATCH] for i in range(0, len(tasks), BATCH)]
    print(f"共 {len(tasks)} 条,分 {len(batches)} 批 (每批{BATCH},并发{WORKERS})")

    results = {}  # id -> {description, genres}
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(call_glm, [{"id": t["id"], "name": t["name"],
                 "category": t["category"], "excerpt": t["excerpt"]} for t in b], key): b for b in batches}
        for fut in as_completed(futs):
            out = fut.result(); done += 1
            for item in out:
                results[item["id"]] = item
            if done % 10 == 0 or done == len(batches):
                print(f"  进度 {done}/{len(batches)} 批, 已得 {len(results)} 条描述")

    # 回写
    updated = 0
    for t in tasks:
        e = t["_idx"]
        md = KB / e["md_path"]
        meta, body = parse_md(md)
        if not meta:
            continue
        r = results.get(e["id"])
        if r and r.get("description"):
            desc = str(r["description"]).strip().replace("\n", " ")[:120]
            meta["description"] = json.dumps(desc, ensure_ascii=False)
            # 合并 genres 到 tags.题材
            tags = json.loads(meta.get("tags", "{}"))
            gens = [g for g in (r.get("genres") or []) if isinstance(g, str)]
            existing = set(tags.get("题材", []))
            for g in gens:
                if g in GENRE_VOCAB.split():
                    existing.add(g)
            if existing:
                tags["题材"] = sorted(existing)
            meta["tags"] = json.dumps(tags, ensure_ascii=False)
            e["description"] = desc
            e["tags"] = tags
            write_md(md, meta, body)
            updated += 1
    (KB / "kb_index.json").write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完成: 精修 {updated}/{len(tasks)} 条 description")


if __name__ == "__main__":
    main()
