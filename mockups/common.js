// Shared by the mockups: sample questions, a safe formatter (a markdown subset built as DOM nodes,
// never innerHTML), swipe detection and the theme setting.

export const CARDS = [
  {
    kind: "card",
    topic: "How networks move data",
    front: "A web page reaches your browser. Name the layers it passes through **from the bottom up**, with each layer's job and main protocol.",
    back: "| Layer | Job | Main protocol |\n|---|---|---|\n| 1 | Physical link | cable, fibre, radio |\n| 2 | Delivery on one network | Ethernet |\n| 3 | Delivery across networks | IP |\n| 4 | Delivery to applications | TCP, UDP |\n| 7 | Applications | HTTP |",
    points: ["**Layer 1** the physical link", "**Layer 2** delivery on one network, with **Ethernet**",
      "**Layer 3** delivery across networks, with **IP**", "**Layer 4** delivery to applications, with **TCP and UDP**",
      "**Layer 7** application protocols such as **HTTP**"],
  },
  {
    kind: "card",
    topic: "How networks move data",
    front: "One program on your laptop answers requests, another asks a remote machine for updates. Which is the **client**, which the **server**, and what decides it?",
    back: "The client **starts** by sending a request; the server **waits** for requests and answers them. It is a **role**, not a kind of machine.",
    points: ["The client **starts** the exchange with a request", "The server **waits** and answers",
      "It is a **role**: whoever asks is the client"],
  },
  {
    kind: "choice",
    topic: "Devices and services",
    front: "Two apps run on the **same server**. A device must send their traffic to **different backends**. Which label must it read?",
    options: [
      { text: "The destination MAC address", trap: "MAC picks the interface on one link, not the app" },
      { text: "The destination IP address", trap: "IP picks the device, and both apps share it" },
      { text: "The destination port", right: true },
      { text: "The IP protocol number", trap: "It names TCP or UDP, not the app" },
    ],
    why: "Only the port (Layer 4) tells two apps on one host apart; MAC and IP are the same for both.",
  },
];

export const SESSION = { due: 12, done: 0, again: 0, aiWaiting: 8 };

function inline(parent, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  for (const p of parts) {
    if (!p) continue;
    let node;
    if (p.startsWith("**")) { node = document.createElement("strong"); node.textContent = p.slice(2, -2); }
    else if (p.startsWith("`")) { node = document.createElement("code"); node.textContent = p.slice(1, -1); }
    else node = document.createTextNode(p);
    parent.append(node);
  }
}

// Paragraphs, **bold**, `code`, "- " and "1. " lists, and | tables |.
export function rich(el, text) {
  el.replaceChildren();
  let i = 0;
  const lines = text.split("\n");
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("|")) {
      const table = document.createElement("table");
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      rows.filter((r) => !/^\|[-| ]+\|$/.test(r)).forEach((r, n) => {
        const tr = table.insertRow();
        r.slice(1, -1).split("|").forEach((c) => {
          const cell = document.createElement(n === 0 ? "th" : "td");
          inline(cell, c.trim());
          tr.append(cell);
        });
      });
      el.append(table);
    } else if (/^(- |\d+\. )/.test(line)) {
      const list = document.createElement(line.startsWith("- ") ? "ul" : "ol");
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) {
        const li = document.createElement("li");
        inline(li, lines[i++].replace(/^(- |\d+\. )/, ""));
        list.append(li);
      }
      el.append(list);
    } else {
      if (line.trim()) {
        const p = document.createElement("p");
        inline(p, line);
        el.append(p);
      }
      i++;
    }
  }
}

export function list(el, items) {
  el.replaceChildren(...items.map((t) => { const li = document.createElement("li"); inline(li, t); return li; }));
}

// Calls handlers.left / right / up with the swipe; reports drag offsets to handlers.move for visual feedback.
export function swipe(el, handlers) {
  let x0, y0, dx = 0, dy = 0, active = false;
  el.addEventListener("pointerdown", (e) => { active = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; });
  el.addEventListener("pointermove", (e) => {
    if (!active) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    handlers.move?.(dx, dy);
  });
  el.addEventListener("pointerup", () => {
    if (!active) return;
    active = false;
    const t = 80;
    if (Math.abs(dx) > t && Math.abs(dx) > Math.abs(dy)) (dx > 0 ? handlers.right : handlers.left)?.();
    else if (dy < -t) handlers.up?.();
    else handlers.cancel?.();
    handlers.move?.(0, 0);
  });
}

// "system" follows the phone; "light" and "dark" override it.
export function theme(select) {
  const apply = (v) => {
    const dark = v === "dark" || (v === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  const saved = localStorage.getItem("mock-theme") || "system";
  if (select) {
    select.value = saved;
    select.addEventListener("change", () => { localStorage.setItem("mock-theme", select.value); apply(select.value); });
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(localStorage.getItem("mock-theme") || "system"));
  apply(saved);
}
