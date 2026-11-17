// The markdown subset of practice texts, built as DOM nodes (never innerHTML): **bold**, `code`, ==marked quote==,
// paragraphs, "- " and "1. " lists, | tables |.

export function inline(parent, text) {
  for (const part of text.split(/(==.+?==)/)) {
    if (!part) continue;
    if (part.startsWith("==") && part.endsWith("==") && part.length > 4) {
      const mark = document.createElement("mark");
      inline(mark, part.slice(2, -2));
      parent.append(mark);
      continue;
    }
    for (const p of part.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!p) continue;
      let node;
      if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
        node = document.createElement("strong");
        node.textContent = p.slice(2, -2);
      } else if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
        node = document.createElement("code");
        node.textContent = p.slice(1, -1);
      } else node = document.createTextNode(p);
      parent.append(node);
    }
  }
}

export function rich(el, text) {
  el.replaceChildren();
  const lines = (text || "").split("\n");
  let i = 0;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    inline(p, para.join(" "));
    el.append(p);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("|")) {
      flush();
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++].trim());
      rows.filter((r) => !/^\|[-:| ]+\|$/.test(r)).forEach((r, n) => {
        const tr = table.insertRow();
        r.replace(/^\||\|$/g, "").split("|").forEach((c) => {
          const cell = document.createElement(n === 0 ? "th" : "td");
          inline(cell, c.trim());
          tr.append(cell);
        });
      });
      wrap.append(table);
      el.append(wrap);
    } else if (/^(- |\d+\. )/.test(line)) {
      flush();
      const list = document.createElement(line.startsWith("- ") ? "ul" : "ol");
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        const li = document.createElement("li");
        inline(li, lines[i++].replace(/^(- |\d+\. )/, ""));
        list.append(li);
      }
      el.append(list);
    } else {
      if (line.trim()) para.push(line.trim());
      else flush();
      i++;
    }
  }
  flush();
}
