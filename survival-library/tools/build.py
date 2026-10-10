#!/usr/bin/env python3
"""
Build script for the Survival Library.

  python3 tools/build.py            # index articles + catalog prints (+ render STLs if openscad exists)
  python3 tools/build.py --render   # force re-render every STL
  python3 tools/build.py --no-render

Outputs (all inside web/):
  content/library.json   - article index + full text (powers search & reader)
  prints/catalog.json    - 3D print catalog parsed from the @tags in each .scad
  prints/stl/*.stl       - rendered models
  maps/catalog.json      - list of offline map files found in maps/regions and maps/images
  survival-library-offline.html - single-file copy of every article for people to save to their phone
  survival-library-node.zip     - the whole project (minus big map files) for starting another hotspot
"""
import html, json, os, re, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
ARTICLES = os.path.join(WEB, "content", "articles")
PRINTS = os.path.join(WEB, "prints")
SRC = os.path.join(PRINTS, "src")
STL = os.path.join(PRINTS, "stl")
MAPS = os.path.join(WEB, "maps")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------- articles
def parse_front_matter(text):
    meta = {}
    if text.startswith("---"):
        end = text.index("\n---", 3)
        for line in text[3:end].strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[end + 4:].lstrip("\n")
    return meta, text


def build_articles():
    items = []
    for fn in sorted(os.listdir(ARTICLES)):
        if not fn.endswith(".md"):
            continue
        with open(os.path.join(ARTICLES, fn), encoding="utf-8") as f:
            meta, body = parse_front_matter(f.read())
        items.append({
            "id": fn[:-3],
            "title": meta.get("title", fn[:-3]),
            "category": meta.get("category", "General"),
            "order": int(meta.get("order", 50)),
            "summary": meta.get("summary", ""),
            "priority": meta.get("priority", "") == "true",
            "body": body,
        })
    items.sort(key=lambda a: (a["category"], a["order"], a["title"]))
    with open(os.path.join(WEB, "content", "library.json"), "w", encoding="utf-8") as f:
        json.dump({"generated": time.strftime("%Y-%m-%d"), "articles": items}, f, ensure_ascii=False)
    print(f"articles: {len(items)}")
    return items


# ---------------------------------------------------------------- prints
def parse_scad(path):
    meta = {"variants": []}
    for line in open(path, encoding="utf-8"):
        m = re.match(r"//\s*@(\w+)\s+(.*)", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if key == "variant":
            name, args = [p.strip() for p in val.split("|", 1)]
            meta["variants"].append({"name": name, "args": args})
        else:
            meta[key] = val
    return meta


def defines(args):
    """'-D a=1 -D part="x"' -> ['-D', 'a=1', '-D', 'part="x"'] without needing a shell."""
    out = []
    for d in re.findall(r"-D\s+(\S+)", args):
        out += ["-D", d]
    return out


def ascii_to_binary_stl(path):
    """OpenSCAD 2021 writes ASCII STL; binary is ~5x smaller - matters on a Pi serving many phones."""
    import struct
    with open(path, "rb") as f:
        head = f.read(5)
    if head != b"solid":
        return
    tris, normal, verts = [], None, []
    with open(path, encoding="ascii", errors="replace") as f:
        for line in f:
            w = line.split()
            if not w:
                continue
            if w[0] == "facet":
                normal, verts = tuple(float(x) for x in w[2:5]), []
            elif w[0] == "vertex":
                verts.append(tuple(float(x) for x in w[1:4]))
            elif w[0] == "endfacet":
                tris.append((normal, verts))
    with open(path, "wb") as f:
        f.write(b"Survival Library binary STL".ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for n, v in tris:
            f.write(struct.pack("<12fH", *n, *v[0], *v[1], *v[2], 0))


def render(job):
    src, out, args = job
    t = time.time()
    r = subprocess.run(["openscad", "-o", out] + defines(args) + [src],
                       capture_output=True, text=True)
    ok = r.returncode == 0 and os.path.exists(out)
    if ok:
        ascii_to_binary_stl(out)
    msg = "ok" if ok else "FAILED\n" + r.stderr[-2000:]
    print(f"  {os.path.basename(out):45s} {time.time()-t:6.1f}s {msg}", flush=True)
    return ok


def build_prints(force=False, allow_render=True):
    os.makedirs(STL, exist_ok=True)
    have_scad = shutil.which("openscad") is not None
    catalog, jobs = [], []
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".scad"):
            continue
        meta = parse_scad(os.path.join(SRC, fn))
        base = fn[:-5]
        variants = meta["variants"] or [{"name": "default", "args": ""}]
        files = []
        for v in variants:
            stl = base + ("" if v["name"] == "default" else "_" + slug(v["name"])) + ".stl"
            out = os.path.join(STL, stl)
            stale = not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(os.path.join(SRC, fn))
            if allow_render and have_scad and (force or stale):
                jobs.append((os.path.join(SRC, fn), out, v["args"]))
            files.append({"name": v["name"], "stl": "prints/stl/" + stl})
        catalog.append({
            "id": base,
            "title": meta.get("title", base),
            "category": meta.get("category", "Misc"),
            "material": meta.get("material", ""),
            "print": meta.get("print", ""),
            "summary": meta.get("summary", ""),
            "use": meta.get("use", ""),
            "source": "prints/src/" + fn,
            "files": files,
        })
    if jobs:
        print(f"rendering {len(jobs)} STL files with OpenSCAD (this can take a while)...")
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
            results = list(ex.map(render, jobs))
        if not all(results):
            print("some renders failed", file=sys.stderr)
    elif not have_scad:
        print("openscad not found: skipping STL rendering (using existing STL files)")
    for fn in os.listdir(STL):
        if fn.endswith(".stl"):
            ascii_to_binary_stl(os.path.join(STL, fn))
    for item in catalog:
        for f in item["files"]:
            p = os.path.join(WEB, f["stl"])
            f["bytes"] = os.path.getsize(p) if os.path.exists(p) else 0
    catalog.sort(key=lambda c: (c["category"], c["title"]))
    with open(os.path.join(PRINTS, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
    print(f"prints: {len(catalog)} designs, {sum(len(c['files']) for c in catalog)} STL files")


# ---------------------------------------------------------------- maps
def build_maps():
    out = {"pmtiles": [], "images": []}
    rdir, idir = os.path.join(MAPS, "regions"), os.path.join(MAPS, "images")
    for fn in sorted(os.listdir(rdir)) if os.path.isdir(rdir) else []:
        if fn.endswith(".pmtiles"):
            out["pmtiles"].append({"name": fn[:-8].replace("_", " "), "url": "maps/regions/" + fn,
                                   "bytes": os.path.getsize(os.path.join(rdir, fn))})
    for fn in sorted(os.listdir(idir)) if os.path.isdir(idir) else []:
        if fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".svg")):
            out["images"].append({"name": os.path.splitext(fn)[0].replace("_", " "), "url": "maps/images/" + fn,
                                  "bytes": os.path.getsize(os.path.join(idir, fn))})
    with open(os.path.join(MAPS, "catalog.json"), "w") as f:
        json.dump(out, f, indent=1)
    print(f"maps: {len(out['pmtiles'])} vector regions, {len(out['images'])} map images")


# ---------------------------------------------------------------- offline single file
def md_to_html(md):
    """Small markdown renderer (same subset as web/js/markdown.js) for the offline file."""
    out, para, lst, in_code = [], [], None, False

    def inline(t):
        t = html.escape(t, quote=False)
        t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
        t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"(?<![*\w])\*([^*]+)\*(?!\w)", r"<em>\1</em>", t)
        t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", t)
        return t

    def flush():
        nonlocal para, lst
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para = []
        if lst:
            out.append(f"<{lst[0]}>" + "".join(f"<li>{inline(i)}</li>" for i in lst[1]) + f"</{lst[0]}>")
            lst = None

    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            if in_code:
                out.append("</pre>")
            else:
                out.append("<pre>")
            in_code = not in_code
        elif in_code:
            out.append(html.escape(line))
        elif re.match(r"^(-{3,}|\*{3,}|_{3,})\s*$", line):
            flush()
            out.append("<hr>")
        elif re.match(r"^#{1,4} ", line):
            flush()
            n = len(line) - len(line.lstrip("#"))
            out.append(f"<h{n+1}>{inline(line[n+1:])}</h{n+1}>")
        elif line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if not re.match(r"^\|[\s:|-]+\|$", lines[i]):
                    rows.append([c.strip() for c in lines[i].strip("|").split("|")])
                i += 1
            i -= 1
            out.append("<table>" + "".join(
                "<tr>" + "".join((f"<th>{inline(c)}</th>" if r == 0 else f"<td>{inline(c)}</td>") for c in row) + "</tr>"
                for r, row in enumerate(rows)) + "</table>")
        elif line.startswith("> "):
            flush()
            out.append(f"<blockquote>{inline(line[2:])}</blockquote>")
        elif re.match(r"^\s*[-*] ", line) or re.match(r"^\s*\d+\. ", line):
            kind = "ol" if re.match(r"^\s*\d+\. ", line) else "ul"
            if para:
                flush()
            if not lst or lst[0] != kind:
                flush()
                lst = (kind, [])
            lst[1].append(re.sub(r"^\s*([-*]|\d+\.) ", "", line))
        elif not line.strip():
            flush()
        else:
            if lst:
                lst[1][-1] += " " + line.strip()
            else:
                para.append(line.strip())
        i += 1
    flush()
    return "\n".join(out)


def build_offline(articles):
    cats = {}
    for a in articles:
        cats.setdefault(a["category"], []).append(a)
    toc, body = [], []
    for c, arts in cats.items():
        toc.append(f"<li><b>{html.escape(c)}</b><ul>" + "".join(
            f'<li><a href="#{a["id"]}">{html.escape(a["title"])}</a></li>' for a in arts) + "</ul></li>")
        for a in arts:
            body.append(f'<article id="{a["id"]}"><h1>{html.escape(a["title"])}</h1>'
                        f'<p class="cat">{html.escape(c)}</p>{md_to_html(a["body"])}'
                        f'<p><a href="#top">&uarr; contents</a></p></article>')
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Survival Library (offline copy)</title>
<style>
body{{font:17px/1.55 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem;background:#fbf8f1;color:#1d1b16}}
h1{{border-top:3px solid #b5482d;padding-top:1rem;margin-top:3rem}} h2{{margin-top:2rem}}
.cat{{color:#7a6f5d;margin-top:-.8rem}} table{{border-collapse:collapse;width:100%}} td,th{{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}}
blockquote{{border-left:4px solid #b5482d;margin:1rem 0;padding:.5rem 1rem;background:#f3e6dc}}
pre{{background:#eee;padding:.6rem;overflow:auto}} code{{background:#eee;padding:0 .2rem}}
@media (prefers-color-scheme:dark){{body{{background:#14130f;color:#e8e2d4}} blockquote{{background:#2a1f1a}} pre,code{{background:#26241f}} td,th{{border-color:#444}}}}
</style></head><body><a id="top"></a>
<h1 style="border:0">Survival Library &mdash; offline copy</h1>
<p>Saved {time.strftime("%Y-%m-%d")}. This single file works with no network. Keep it on your phone (open it from your Files / Downloads app) and pass it on.</p>
<ul>{''.join(toc)}</ul>
{''.join(body)}
</body></html>"""
    with open(os.path.join(WEB, "survival-library-offline.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print("offline single-file copy written")


def build_zip():
    """Whole library (minus big map files) so anyone can start a new hotspot node."""
    import zipfile
    out = os.path.join(WEB, "survival-library-node.zip")
    skip_dirs = {os.path.join(MAPS, "regions"), os.path.join(ROOT, ".git")}
    n = 0
    with zipfile.ZipFile(out + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if os.path.join(base, d) not in skip_dirs and not d.startswith(".") and d != "__pycache__"]
            for fn in files:
                p = os.path.join(base, fn)
                if fn.startswith("survival-library-node.zip") or fn.endswith(".pyc"):
                    continue
                if base == os.path.join(MAPS, "images") and os.path.getsize(p) > 50 * 1024 * 1024:
                    continue
                z.write(p, os.path.join("survival-library", os.path.relpath(p, ROOT)))
                n += 1
    os.replace(out + ".tmp", out)
    print(f"zip: {n} files, {os.path.getsize(out)/1048576:.1f} MB")


if __name__ == "__main__":
    arts = build_articles()
    build_prints(force="--render" in sys.argv, allow_render="--no-render" not in sys.argv)
    build_maps()
    build_offline(arts)
    build_zip()
