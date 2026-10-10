/* Tiny Markdown renderer for the library's articles.
   Supports: # headings, paragraphs, - / 1. lists, - [ ] checklists, | tables |,
   > quotes, ``` code, **bold**, *italic*, `code`, [links](url). */
(function () {
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*\w])\*([^*]+)\*(?!\w)/g, "$1<em>$2</em>");
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, txt, url) {
      if (/^javascript:/i.test(url)) return txt;
      return '<a href="' + url.replace(/"/g, "%22") + '">' + txt + "</a>";
    });
    return t;
  }
  function slug(s) {
    return s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function render(md) {
    var lines = md.split(/\r?\n/), out = [], para = [], list = null, inCode = false, code = [];
    function flush() {
      if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
      if (list) {
        var cls = list.check ? ' class="check"' : "";
        out.push("<" + list.kind + cls + ">" + list.items.map(function (i) {
          var m = /^\[( |x)\] (.*)$/i.exec(i);
          if (m) return '<li><label><input type="checkbox"' + (m[1] !== " " ? " checked" : "") + "> " + inline(m[2]) + "</label></li>";
          return "<li>" + inline(i) + "</li>";
        }).join("") + "</" + list.kind + ">");
        list = null;
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;
      if (/^```/.test(line)) {
        if (inCode) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = []; }
        else flush();
        inCode = !inCode; continue;
      }
      if (inCode) { code.push(line); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flush();
        out.push("<hr>");
      } else if ((m = /^(#{1,4}) (.*)$/.exec(line))) {
        flush();
        var n = m[1].length + 1, h = inline(m[2]);
        out.push("<h" + n + ' id="' + slug(h) + '">' + h + "</h" + n + ">");
      } else if (/^\|/.test(line)) {
        flush();
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|"));
          i++;
        }
        i--;
        out.push("<table>" + rows.map(function (r, ri) {
          var tag = ri === 0 ? "th" : "td";
          return "<tr>" + r.map(function (c) { return "<" + tag + ">" + inline(c.trim()) + "</" + tag + ">"; }).join("") + "</tr>";
        }).join("") + "</table>");
      } else if (/^> ?/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^> ?/.test(lines[i])) { q.push(lines[i].replace(/^> ?/, "")); i++; }
        i--;
        out.push("<blockquote><p>" + inline(q.join(" ")) + "</p></blockquote>");
      } else if ((m = /^\s*([-*]|\d+\.) (.*)$/.exec(line))) {
        var kind = /\d/.test(m[1]) ? "ol" : "ul";
        if (para.length) flush();
        if (!list || list.kind !== kind) { flush(); list = { kind: kind, items: [], check: false }; }
        if (/^\[( |x)\] /i.test(m[2])) list.check = true;
        list.items.push(m[2]);
      } else if (!line.trim()) {
        flush();
      } else if (list) {
        list.items[list.items.length - 1] += " " + line.trim();
      } else {
        para.push(line.trim());
      }
    }
    if (inCode) out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
    flush();
    return out.join("\n");
  }
  window.Markdown = { render: render, escape: esc, slug: slug };
})();
