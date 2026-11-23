import { GitHub, Offline, BadToken, Conflict } from "./github.js?v=2026-11-23.2";
import { Engine, STATE_DIR } from "./engine.js?v=2026-11-23.2";
import { outboxAll, outboxPut, outboxDelete, keepStorage, snapshotGet, snapshotPut } from "./store.js?v=2026-11-23.2";
import { inline, rich } from "./rich.js?v=2026-11-23.2";

// Bump with stamp.py on every release: the page compares it with version.json to offer a reload.
const VERSION = "2026-11-23.2";

const params = new URLSearchParams(location.search);
const onThisComputer = ["localhost", "127.0.0.1"].includes(location.hostname);
// the api override would let a crafted link receive the token, so it only works on a local test server
const API = (onThisComputer && params.get("api")) || "https://api.github.com";
const REPO = params.get("repo") || "MiguelLopezVirues/pca-study";
const TOKEN_KEY = "pca-token";
const TOKEN_EXPIRES_KEY = "pca-token-expires";
const THEME_KEY = "pca-theme";
const VAULT = "vault";  // the vault name Obsidian shows on the phone (the GitSync copy of pca-study/vault)
const ANSWERS = `${STATE_DIR}/answers.jsonl`;
const TOPICS = "pilot/practice/topics.json";
const CONCERNS = "lean/concerns.tsv";
const EXPLAIN = "pilot/practice/explain";
const READ_DIRS = ["pilot/practice/items", "pilot/practice/items_lean", STATE_DIR, EXPLAIN];
const READ_FILES = ["graph-tools/tsv_write.py", "pilot/idea_links.tsv", "lean/idea_links.tsv", "lean/path.tsv", "lean/concerns.tsv", "pilot/relevance_final.tsv",
  "pilot/practice/engine.py", "pilot/practice/config.json", TOPICS];
const MAX_TRIES = 4;
const SAVE_EVERY = 5;
const SAVE_IDLE_MS = 30_000;

const $ = (id) => document.getElementById(id);
const LABELS = {
  loading: "Loading…", ready: "Ready", done: "Done for now", offline: "Offline",
  "token-expired": "Token not accepted: enter a new one", "no-token": "Enter your token", error: "Something went wrong",
};
const SYNC_LABELS = { idle: "Saved", saving: "Saving…", offline: "Offline", "token-expired": "Not saved", error: "Not saved" };
const CHANNEL = { flashcard: ["card", "Self-graded"], choice: ["choice", "Multiple choice"], ai: ["pen", "Open · AI"] };
const STATUS = { due: "Due now", new: "New", learn: "Learning", later: "Later", ai: "Needs AI", locked: "Opens later", aside: "Set aside" };
const FILTERS = ["all", "due", "new", "learn", "ai", "later", "locked", "aside"];

// ---------- icons: one set, 24-unit grid, built as DOM nodes ----------
const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  cards: "M7 4h11a2 2 0 0 1 2 2v11M4 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  chart: "M4 20V11M10 20V5M16 20v-6M3 20h18",
  gear: "M4 6h7M15 6h5M4 12h2M10 12h10M4 18h10M18 18h2M13 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  check: "M5 12.5 10 17l9-10", x: "M6 6l12 12M18 6 6 18", zap: "M13 2 4 14h7l-1 8 9-12h-7z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", mount: "M3 20 9.5 8l4 7 2.5-4L21 20z",
  card: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 9h8M8 13h5",
  choice: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  pen: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  right: "M9 6l6 6-6 6", close: "M6 6l12 12M18 6 6 18", flag: "M5 21V4h11l-1.5 4L16 12H5",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  key: "M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4", filter: "M3 5h18l-7 8v6l-4 2v-8z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5",
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
};
const SVG = "http://www.w3.org/2000/svg";
function ic(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", P[name]);
  svg.append(path);
  return svg;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
document.querySelectorAll("[data-icon]").forEach((n) => n.prepend(ic(n.dataset.icon)));

// ---------- state ----------
let engine;
let enginePromise;
let current = null;
let base = null;      // the GitHub version the engine state builds on: {repo, commit, tree, files}
let baseLog = "";     // answers.jsonl in that version
let applied = [];     // answers (and read events) recorded in the engine on top of base, oldest first
let saving = null;
let saveAgain = false;
let idleTimer;
let tab = "today";
let session = { done: 0 };
let explaining = false;  // a No or With effort answer is recorded and its explanation is open
let explainIndex = null; // {files, items: Map(item id -> {note, blocks, diagrams})}
const diagramUrls = new Map();
const cardsView = { query: "", filter: "all", group: "concern", hiddenTopics: new Set(), hiddenChannels: new Set(), onlyDiagrams: false };
const openGroups = new Set();  // folded groups the learner opened
let viewTurn = null;  // the turn shown in Cards and Topics: "all" or 1-3; starts on the learner's current turn

const now = () => new Date().toISOString();
const channelOf = (c) => (CHANNEL[c] ? c : "ai");
let topicsCache = { files: null, list: [] };
const topics = () => {
  if (topicsCache.files === base?.files) return topicsCache.list;
  const names = concernByPrefix();
  let list = [];
  try {
    list = JSON.parse(base?.files?.[TOPICS] || "[]").map((t) => ({ ...t, concern: names[t.topic.split("-")[0]] || t.concern || "Other" }));
  } catch { /* no reading list yet */ }
  topicsCache = { files: base?.files, list };
  return list;
};
// lean/concerns.tsv: topic id prefix -> concern name
function concernByPrefix() {
  const [head, ...rows] = (base?.files?.[CONCERNS] || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.split("\t"));
  const p = head?.indexOf("prefix") ?? -1;
  const c = head?.indexOf("concern") ?? -1;
  return p < 0 || c < 0 ? {} : Object.fromEntries(rows.filter((r) => r[p] && r[c]).map((r) => [r[p], r[c]]));
}
const topicTitle = (id) => topics().find((t) => t.topic === id)?.title || id;

function setState(state, detail = "") {
  $("status").dataset.state = state;
  $("status").textContent = LABELS[state] + (detail ? `: ${detail}` : "");
  if (["token-expired", "no-token"].includes(state)) openToken();
}

function setSync(state) {
  $("sync").dataset.state = state;
  $("sync").textContent = SYNC_LABELS[state];
}

async function showPending() {
  const n = (await outboxAll()).length;
  $("pending").dataset.count = String(n);
  $("pending").textContent = n ? `${n} not saved` : "";
}

function github() {
  return new GitHub(API, REPO, localStorage.getItem(TOKEN_KEY));
}

function answerIds(text) {
  return new Set((text || "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l).id));
}

function logLine(a) {
  if (a.type === "read") return JSON.stringify({ id: a.id, type: "read", topic: a.topic, time: a.time }) + "\n";
  if (a.type === "turn") return JSON.stringify({ id: a.id, type: "turn", turn: a.turn, time: a.time }) + "\n";
  if (a.type === "aside") return JSON.stringify({ id: a.id, type: "aside", item: a.item, aside: a.aside, time: a.time }) + "\n";
  return JSON.stringify({ id: a.id, item: a.item, rating: a.rating, time: a.time, minutes: a.minutes,
    prompt: a.prompt || "card:1", ...(a.flags ? { flags: a.flags } : {}), ...(a.ticked ? { ticked: a.ticked } : {}),
    ...(a.chosen ? { chosen: a.chosen } : {}), ...(a.reason ? { reason: a.reason } : {}) }) + "\n";
}

// ---------- loading and saving ----------
// Run the engine on a repository version, then apply the answers still on the phone on top of it.
async function loadBase(snap) {
  engine ??= await enginePromise;
  engine.load(snap.files);
  base = snap;
  baseLog = snap.files[ANSWERS] || "";
  applied = [];
  const saved = answerIds(baseLog);
  const outbox = (await outboxAll()).sort((a, b) => a.time.localeCompare(b.time));
  const done = outbox.filter((a) => saved.has(a.id)).map((a) => a.id);
  if (done.length) await outboxDelete(done);
  for (const a of outbox.filter((x) => !saved.has(x.id))) {
    engine.record(a);
    applied.push(a);
  }
}

async function loadFromGitHub(gh) {
  const head = await gh.head();
  const files = await gh.read(head.tree, READ_DIRS, READ_FILES);
  await loadBase({ repo: `${API}/${REPO}`, ...head, files });
  await snapshotPut(base);
}

function commitMessage(batch) {
  if (batch.length > 1) return `practice: ${batch.length} answers (phone)`;
  const a = batch[0];
  if (a.type === "turn") return `practice: turn ${a.turn} (phone)`;
  if (a.type === "aside") return `practice: ${a.item} ${a.aside ? "set aside" : "brought back"} (phone)`;
  return a.type === "read" ? `practice: ${a.topic} read (phone)` : `practice: ${a.item} rated ${a.rating} (phone)`;
}

async function commitApplied(gh) {
  const batch = applied.slice();
  const log = baseLog + batch.map(logLine).join("");
  const files = { ...engine.stateFiles(), [ANSWERS]: log };
  const saved = await gh.commit(base, files, commitMessage(batch));
  base = { ...base, ...saved, files: { ...base.files, ...files } };
  baseLog = log;
  applied = applied.slice(batch.length);
  await outboxDelete(batch.map((a) => a.id));
  await snapshotPut(base);
}

// Bring the phone and GitHub together: reload only if GitHub moved, then commit the answers made on top.
function save() {
  clearTimeout(idleTimer);
  if (saving) {
    saveAgain = true;
    return saving;
  }
  saving = (async () => {
    setSync("saving");
    try {
      const gh = github();
      for (let attempt = 1; ; attempt++) {
        if (!base || (await gh.ref()) !== base.commit) {
          await loadFromGitHub(gh);
          refreshCard();
        }
        if (!applied.length) break;
        try {
          await commitApplied(gh);
          break;
        } catch (e) {
          if (!(e instanceof Conflict) || attempt >= MAX_TRIES) throw e;
        }
      }
      setSync("idle");
      if ($("status").dataset.state === "token-expired") setState(current ? "ready" : "done");
    } catch (e) {
      fail(e);
    } finally {
      saving = null;
      await showPending();
    }
    if (saveAgain) {
      saveAgain = false;
      if (applied.length) await save();
    }
  })();
  return saving;
}

function scheduleSave(soon) {
  clearTimeout(idleTimer);
  if (soon || applied.length >= SAVE_EVERY) save();
  else idleTimer = setTimeout(save, SAVE_IDLE_MS);
}

function fail(e) {
  if (e instanceof Offline) {
    setSync("offline");
    if ($("status").dataset.state === "loading") setState("offline");
  } else if (e instanceof BadToken) {
    setSync("token-expired");
    setState("token-expired");
  } else {
    console.error(e);
    setSync("error");
    if ($("status").dataset.state === "loading") setState("error", e.message);
  }
}

// Keep something the phone did (an answer, a topic read): in the outbox, in the engine, then saved in the background.
async function keep(event, soon) {
  await outboxPut(event);
  engine.record(event);
  applied.push(event);
  await showPending();
  scheduleSave(soon);
}

// ---------- tabs ----------
function show(name) {
  tab = name;
  document.body.classList.toggle("practising", name === "practice");
  for (const v of ["today", "practice", "topics", "cards", "progress", "settings"]) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  render();
}

function render() {
  renderSettings();
  if (!engine || !base) return;
  viewTurn ??= engine.overview(now()).turn || 1;
  if (tab === "today") renderToday();
  else if (tab === "topics") renderTopics();
  else if (tab === "cards") renderCards();
  else if (tab === "progress") renderProgress();
}

function renderSettings() {
  $("page-version").textContent = `Page version ${VERSION}`;
  $("explain-count").textContent = base ? `Explanations for ${explanations().size} questions` : "Not loaded yet";
  const turn = engine && base ? engine.overview(now()).turn : null;
  document.querySelectorAll("#turn-choice button").forEach((b) => b.classList.toggle("on", Number(b.dataset.setTurn) === turn));
}

// Moving to another turn opens its questions in the topics read; saved like an answer.
async function setTurn(n) {
  if (!engine || !base || engine.overview(now()).turn === n) return;
  await keep({ id: crypto.randomUUID(), type: "turn", turn: n, time: now() }, true);
  viewTurn = n;
  if (tab !== "practice") setState(showCard());
  render();
}

// "Not now": a question set aside is not asked and does not hold its turn open; Cards brings it back.
async function setAside(id, aside) {
  if (!engine || !base) return;
  if (current?.id === id) current = null;
  await keep({ id: crypto.randomUUID(), type: "aside", item: id, aside, time: now() }, true);
  if (tab === "practice") setState(showCard());
  else if (!$("preview").hidden) $("preview-aside").textContent = aside ? "Bring back" : "Not now: set aside";
  render();
}

// Phones keep a page open for days: when a newer one is published, offer to reload it.
async function checkVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    $("update").hidden = (await res.json()).version === VERSION;
  } catch { /* offline: checked again next time */ }
}

// ---------- Today ----------
function renderToday() {
  const o = engine.overview(now());
  const left = o.due + o.new;
  $("count-due").textContent = String(o.due);
  $("count-new").textContent = String(o.new);
  $("count-ai").textContent = String(o.ai);
  $("ring-left").textContent = String(left);
  const c = 2 * Math.PI * 44;
  const total = left + session.done;
  $("ring-fill").setAttribute("stroke-dasharray", String(c));
  $("ring-fill").setAttribute("stroke-dashoffset", String(c * (total ? left / total : 1)));
  $("hero-title").textContent = left ? (session.done ? "Keep going" : "Ready when you are") : "All done for now";
  $("hero-sub").textContent = left ? `About ${Math.max(1, Math.round(left * 0.4))} minutes of cards` : "Nothing due now";
  $("start").disabled = !left;
  $("ai-title").textContent = `${o.ai} open question${o.ai === 1 ? "" : "s"}`;
  const ts = o.turn_status;
  $("turn-next").hidden = !(ts.done && ts.next);
  if (ts.done && ts.next) {
    $("turn-next").dataset.turn = String(ts.next);
    $("turn-next-title").textContent = `Turn ${ts.turn} done`;
    $("turn-next-sub").textContent = `Every topic of turn ${ts.turn} read and its questions passed. Move to turn ${ts.next}`;
  }
  const next = topics().find((t) => !o.read.includes(t.topic));
  $("next-topic").hidden = !next;
  if (next) {
    $("next-topic").dataset.topic = next.topic;
    $("next-topic-name").textContent = `${next.title} · about ${next.minutes} min of reading`;
  }
  const days = Object.entries(o.per_day);
  $("week").replaceChildren(...days.map(([d, n], k) => {
    const day = el("div", `day${k === days.length - 1 ? " today" : ""}`);
    const dot = el("i", n ? "on" : "");
    if (n) dot.append(ic("check"));
    day.append(dot, "SMTWTFS"[new Date(`${d}T12:00:00Z`).getUTCDay()]);
    day.title = `${d}: ${n} answer${n === 1 ? "" : "s"}`;
    return day;
  }));
}

// ---------- sheets ----------
function openSheet(id) {
  $(id).hidden = false;
  $("veil").classList.add("open");
}
function closeSheets() {
  $("topic-sheet").hidden = true;
  $("filter-sheet").hidden = true;
  if (localStorage.getItem(TOKEN_KEY)) $("token-form").hidden = true;
  if ($("token-form").hidden) $("veil").classList.remove("open");
}

function openToken() {
  $("token-cancel").hidden = !localStorage.getItem(TOKEN_KEY);
  $("token-expires").value = localStorage.getItem(TOKEN_EXPIRES_KEY) || "";
  $("token-form").hidden = false;
  $("veil").classList.add("open");
}

function closeToken() {
  $("token-form").hidden = true;
  if ($("topic-sheet").hidden && $("filter-sheet").hidden) $("veil").classList.remove("open");
}

// GitHub does not let a web page read a token's expiry, so the date is the one entered with the token.
function tokenDays() {
  const exp = localStorage.getItem(TOKEN_EXPIRES_KEY);
  return exp ? Math.ceil((new Date(`${exp}T00:00:00Z`) - Date.now()) / 86_400_000) : null;
}

function renderToken() {
  const d = tokenDays();
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  $("token-days").textContent = d == null ? "Expiry date not set: tap to add it"
    : d > 0 ? `Expires in ${days(d)}` : "Expired: enter a new one";
  $("token-warning").hidden = d == null || d > 7;
  if (d != null) $("token-warning-text").textContent = d > 0 ? `Token expires in ${days(d)}` : "Token expired";
}

// Read the note in Obsidian (the GitSync copy on the phone), then mark the topic read here to open its cards.
function openTopic(topicId) {
  const t = topics().find((x) => x.topic === topicId);
  if (!t) return;
  const opens = engine.cardList(now()).filter((c) => c.topic === t.topic).length;
  $("topic-title").textContent = t.title;
  $("topic-sub").textContent = `About ${t.minutes} minutes of reading · ${opens} questions open once you have read it`;
  $("read-link").href = `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${encodeURIComponent(t.note.replace(/\.md$/, ""))}`;
  $("mark-read").dataset.topic = t.topic;
  const missing = engine.missing(t.topic).map((u) => {
    const idea = ideas().get(u);
    return idea ? `${topicTitle(idea.topic)} · ${idea.n}. ${idea.label}` : u;
  });
  $("topic-warn").hidden = !missing.length;
  $("topic-warn").textContent = missing.length
    ? `It builds on ideas whose first questions you have not passed yet: ${missing.join("; ")}.` : "";
  openSheet("topic-sheet");
}

async function markRead(topicId) {
  closeSheets();
  await keep({ id: crypto.randomUUID(), type: "read", topic: topicId, time: now() }, true);
  if (tab !== "practice") setState(showCard());
  render();
}

// ---------- explanations: the sheet blocks the key points quote, built on the desktop (build_explain.py) ----------
function explanations() {
  if (!explainIndex || explainIndex.files !== base.files) {
    const items = new Map();
    const ideas = new Map();
    for (const [path, text] of Object.entries(base.files)) {
      if (!path.startsWith(`${EXPLAIN}/`) || !path.endsWith(".json")) continue;
      try {
        const o = JSON.parse(text);
        for (const [id, blocks] of Object.entries(o.items)) items.set(id, { topic: o.topic, note: o.note, blocks, diagrams: o.diagrams });
        for (const [unit, idea] of Object.entries(o.ideas || {})) ideas.set(unit, { ...idea, unit, topic: o.topic, n: Number(unit.split(".").pop()) });
      } catch { /* a broken file only loses its own explanations */ }
    }
    explainIndex = { files: base.files, items, ideas };
  }
  return explainIndex.items;
}

function ideas() {
  explanations();
  return explainIndex.ideas;
}

const hasDiagram = (id) => Boolean(explanations().get(id)?.blocks.some((b) => b.diagrams.length));

// Every question with its status, unit and whether its explanation has a diagram.
function cardList() {
  return engine.cardList(now()).map((c) => ({ ...c, diagram: hasDiagram(c.id) }));
}

function ideaTitle(unit, topic) {
  const idea = ideas().get(unit);
  return idea ? `${topicTitle(idea.topic)} · ${idea.n}. ${idea.label}` : `${topicTitle(topic)} · across the topic`;
}

function diagramUrl(topic, n, svg) {
  const key = `${topic}:${n}:${svg.length}`;
  if (!diagramUrls.has(key)) diagramUrls.set(key, URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
  return diagramUrls.get(key);
}

function renderExplain(host, item) {
  const ex = explanations().get(item.id);
  host.replaceChildren();
  if (!ex) return false;
  const drawn = new Set();
  for (const b of ex.blocks) {
    const div = el("section", "explain-block");
    const a = el("a", "explain-source");
    a.href = `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${encodeURIComponent(`${ex.note.replace(/\.md$/, "")}#${b.heading}`)}`;
    a.append(el("span", "", b.heading), ic("book"));
    const body = el("div", "explain-text");
    rich(body, b.text);
    const fors = el("ul", "explain-for");
    for (const n of b.points) fors.append(pointLi(item.must?.[n]?.point || ""));
    div.append(a, fors, body);
    for (const d of b.diagrams) {
      if (drawn.has(d) || !ex.diagrams[d]) continue;
      drawn.add(d);
      const box = el("button", "diagram-box");
      box.type = "button";
      box.setAttribute("aria-label", `Open the diagram of ${b.heading}`);
      const img = el("img", "diagram");
      img.alt = `Diagram: ${b.heading}`;
      img.src = diagramUrl(ex.topic, d, ex.diagrams[d]);
      box.addEventListener("click", () => openDiagram(img.src, b.heading));
      const hint = el("span", "diagram-hint", "Tap to enlarge");
      box.append(img, hint);
      div.append(box);
    }
    host.append(div);
  }
  return true;
}

// The explanation as a page of its own, over the card. While `explaining`, closing it moves to the next card.
function openExplain(item, afterAnswer) {
  if (!renderExplain($("explain"), item)) return false;
  $("explain-title").textContent = `Why · ${topicTitle(explanations().get(item.id).topic)}`;
  $("explain-next").hidden = !afterAnswer;
  $("explain-back").hidden = afterAnswer;
  $("explain-view").hidden = false;
  $("explain-view").scrollTop = 0;
  return true;
}

function closeExplain() {
  $("explain-view").hidden = true;
  if (explaining) {
    window.scrollTo({ top: 0 });
    setState(showCard());
  }
}

let zoom = 1;
function setZoom(z) {
  zoom = Math.min(5, Math.max(1, z));
  $("diagram-img").style.width = `${zoom * 100}%`;
}

function openDiagram(src, title) {
  $("diagram-img").src = src;
  $("diagram-img").alt = `Diagram: ${title}`;
  $("diagram-title").textContent = title;
  setZoom(1);
  $("diagram-view").hidden = false;
}

function pointLi(text) {
  const li = el("li");
  inline(li, text);
  return li;
}

// ---------- practice ----------
function showCard() {
  const due = engine.flashcards(now());
  explaining = false;
  $("card-flip").classList.remove("flipped");
  $("card-back").hidden = true;
  $("ratings").hidden = true;
  $("know").hidden = false;
  $("came").hidden = true;
  $("reveal").hidden = false;
  $("why").hidden = true;
  $("explain-view").hidden = true;
  $("choice-options").hidden = true;
  $("choice-why").hidden = true;
  $("choice-continue").hidden = true;
  $("choice-reason").hidden = true;
  $("reason-text").value = "";
  $("came-back").hidden = false;
  const left = due.length;
  $("bar").style.width = `${(session.done / Math.max(1, session.done + left)) * 100}%`;
  if (!due.length) {
    current = null;
    $("card").hidden = true;
    $("done").hidden = false;
    return "done";
  }
  const item = engine.item(due[0]);
  $("flag-heavy").setAttribute("aria-pressed", "false");
  if (item.channel === "choice") return showChoice(item);
  const fronts = item.card.fronts?.length ? item.card.fronts : [item.card.front];
  const k = engine.reviewsOf(item.id) % fronts.length;
  current = { id: item.id, item, shown: Date.now(), prompt: `card:${k + 1}` };
  $("card-topic").textContent = `${CHANNEL.flashcard[1]} · ${topicTitle(item.id.split(".")[0])}`;
  rich($("card-front"), fronts[k]);
  rich($("card-back"), item.card.back);
  $("card-points").replaceChildren(...(item.must || []).map((m) => {
    const li = el("li");
    li.setAttribute("role", "checkbox");
    li.setAttribute("aria-checked", "false");
    li.tabIndex = 0;
    const box = el("span", "box");
    box.append(ic("check"));
    const text = el("span");
    inline(text, m.point);
    li.append(box, text);
    li.addEventListener("click", () => {
      li.setAttribute("aria-checked", String(li.getAttribute("aria-checked") !== "true"));
      suggest();
    });
    return li;
  }));
  $("card-points-box").hidden = true;
  $("card").hidden = false;
  $("done").hidden = true;
  suggest();
  return "ready";
}

// Multiple choice: the versions in turn, the options shuffled; the pick is graded at once.
function showChoice(item) {
  const versions = item.choice.versions;
  const k = engine.reviewsOf(item.id) % versions.length;
  current = { id: item.id, item, shown: Date.now(), prompt: `choice:${k + 1}`, needsReason: (item.turn || 1) >= 2 };
  const v = versions[k];
  $("card-topic").textContent = `${CHANNEL.choice[1]} · ${topicTitle(item.id.split(".")[0])}`;
  rich($("card-front"), v.stem);
  const options = v.options.map((o) => ({ o, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.o);
  $("choice-options").replaceChildren(...options.map((o) => {
    const b = el("button", "opt");
    b.type = "button";
    b.dataset.right = String(Boolean(o.right));
    const text = el("span", "opt-text");
    inline(text, o.text);
    b.append(text);
    if (!o.right) {
      const trap = el("span", "trap");
      inline(trap, o.trap || "");
      trap.hidden = true;
      b.append(trap);
    }
    b.addEventListener("click", () => pickChoice(b));
    return b;
  }));
  rich($("choice-why"), `**Why**: ${item.choice.why}`);
  $("card-points").replaceChildren();
  $("choice-options").hidden = false;
  $("reveal").hidden = true;
  $("card").hidden = false;
  $("done").hidden = true;
  return "ready";
}

function pickChoice(button) {
  [...$("choice-options").children].forEach((b) => {
    b.disabled = true;
    if (b.dataset.right === "true") b.classList.add("right");
  });
  $("choice-why").hidden = false;
  current.chosen = button.querySelector(".opt-text").textContent;
  if (button.dataset.right === "true" && current.needsReason) {
    $("choice-reason").hidden = false;
    $("reason-text").focus();
  } else if (button.dataset.right === "true") {
    $("ratings").hidden = false;
    $("know").hidden = true;
    $("came").hidden = false;
    $("came-back").hidden = true;
  } else {
    button.classList.add("wrong");
    button.querySelector(".trap").hidden = false;
    $("choice-continue").hidden = false;
  }
}

// Ticking every key point suggests Yes; ticking only some suggests No.
function suggest() {
  const ticks = [...$("card-points").children].map((li) => li.getAttribute("aria-checked") === "true");
  const all = ticks.length && ticks.every(Boolean);
  const some = ticks.some(Boolean);
  $("know-yes").classList.toggle("suggest", Boolean(all));
  $("know-no").classList.toggle("suggest", some && !all);
}

// After a reload from GitHub: keep the card on screen if it is still due, otherwise show the next one.
function refreshCard() {
  if (explaining) return render();
  const due = engine.flashcards(now());
  if (!(current && due.includes(current.id))) setState(showCard());
  render();
}

async function rate(rating) {
  if (!current) return;
  const answer = {
    id: crypto.randomUUID(), item: current.id, rating, prompt: current.prompt,
    time: now(), minutes: (Date.now() - current.shown) / 60000,
  };
  if ($("flag-heavy").getAttribute("aria-pressed") === "true") answer.flags = ["too-much"];
  if (current.chosen) answer.chosen = current.chosen;
  if (current.reason) answer.reason = current.reason;
  const ticked = [...$("card-points").children].flatMap((li, n) => (li.getAttribute("aria-checked") === "true" ? [n] : []));
  if (ticked.length) answer.ticked = ticked;
  const { item } = current;
  session.done += 1;
  await outboxPut(answer);
  // a reload from GitHub during the wait may already have applied it from the outbox; the card stays current meanwhile
  if (!applied.some((a) => a.id === answer.id)) {
    engine.record(answer);
    applied.push(answer);
  }
  current = null;
  const last = !engine.flashcards(now()).length;
  // after No or With effort the explanation opens by itself; the next card waits for "Next card"
  if ((rating === 1 || rating === 2) && openExplain(item, true)) {
    explaining = true;
    $("ratings").hidden = true;
    $("why").hidden = true;
  } else {
    setState(showCard());
  }
  await showPending();
  scheduleSave(last);
}

// ---------- Cards ----------
function rowMatches(c, ignoreStatus = false) {
  const q = cardsView.query;
  return (!q || c.text.toLowerCase().includes(q) || topicTitle(c.topic).toLowerCase().includes(q))
    && !cardsView.hiddenTopics.has(c.topic) && !cardsView.hiddenChannels.has(channelOf(c.channel))
    && (!cardsView.onlyDiagrams || c.diagram)
    && (ignoreStatus || cardsView.filter === "all" || c.status === cardsView.filter);
}

function cardRow(c) {
  const row = el("button", "rowi card-row");
  row.type = "button";
  Object.assign(row.dataset, { item: c.id, status: c.status, topic: c.topic, channel: channelOf(c.channel),
    diagram: c.diagram ? "yes" : "no", turn: String(c.turn) });
  const icon = el("div", "ic");
  icon.append(ic(CHANNEL[channelOf(c.channel)][0]));
  const tx = el("div", "tx");
  const p = el("p");
  inline(p, c.text.replace(/\n+/g, " "));
  const meta = el("div", "row-meta");
  meta.append(statusTag(c.status, c.due));
  if (c.diagram) {
    const d = el("span", "status has-diagram");
    d.append(ic("image"), "Diagram");
    meta.append(d);
  }
  tx.append(p, meta);
  const chev = el("span", "chev");
  chev.append(ic("eye"));
  row.append(icon, tx, chev);
  row.addEventListener("click", () => preview(c.id));
  return row;
}

function statusTag(status, due) {
  const sp = el("span", "status");
  sp.append(el("i", `dot ${status}`));
  let label = STATUS[status];
  if (status === "later" && due) label = `Next ${new Date(due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  sp.append(label);
  return sp;
}

// ---------- grouping shared by Cards and Topics ----------
const turnOk = (c) => viewTurn === "all" || c.turn === viewTurn;
const concernOf = (topic) => topics().find((t) => t.topic === topic)?.concern || "Other";
const concernNames = () => [...new Set(topics().map((t) => t.concern || "Other"))];

function pill(kind, n, label) {
  const p = el("span", `pill ${kind}`);
  p.dataset.count = kind;
  p.append(el("b", "", String(n)), el("span", "", label));
  return p;
}

function pills(...list) {
  const box = el("span", "pills");
  box.append(...list.filter(Boolean));
  return box;
}

// A folded group with its counts at the right. Opening it by hand folds its open siblings; what is open survives a
// re-render. `forced` opens it without folding the others (a search or a filter showing every match).
function group(cls, key, title, counts, forced = false) {
  const d = el("details", cls);
  d.open = forced || openGroups.has(key);
  const s = el("summary", "group-head");
  const name = el("span", "group-title");
  name.append(...title);
  s.append(ic("right"), name, counts);
  s.addEventListener("click", () => {
    if (d.open) return;
    for (const sib of d.parentElement?.children || []) {
      if (sib !== d && sib.tagName === "DETAILS" && sib.open) sib.open = false;
    }
  });
  d.addEventListener("toggle", () => {
    if (forced) return;
    if (d.open) openGroups.add(key);
    else openGroups.delete(key);
  });
  d.append(s);
  return d;
}

// Open a group and every group around it, folding their siblings, as if tapped from the outside in.
function openPath(d) {
  const chain = [];
  for (let x = d; x; x = x.parentElement?.closest("details")) chain.unshift(x);
  for (const x of chain) {
    if (x.open) continue;
    for (const sib of x.parentElement.children) if (sib !== x && sib.tagName === "DETAILS" && sib.open) sib.open = false;
    x.open = true;
  }
}

function renderTurns(host, all) {
  const counts = { all: all.length };
  for (const c of all) counts[c.turn] = (counts[c.turn] || 0) + 1;
  host.replaceChildren(...["all", 1, 2, 3].map((n) => {
    const b = el("button", n === viewTurn ? "on" : "");
    b.type = "button";
    b.dataset.turn = String(n);
    b.append(el("span", "", n === "all" ? "All" : `Turn ${n}`), el("b", "", String(counts[n] || 0)));
    b.disabled = n !== "all" && !counts[n];
    b.addEventListener("click", () => { viewTurn = n; render(); });
    return b;
  }));
}

function statusPills(list) {
  const n = (s) => list.filter((c) => c.status === s).length;
  return pills(pill("questions", list.length, "questions"), n("due") && pill("due", n("due"), "due"),
    n("new") && pill("new", n("new"), "new"), n("ai") && pill("ai", n("ai"), "AI"));
}

// ---------- Cards ----------
function renderCards() {
  const all = cardList();
  renderTurns($("cards-turns"), all);
  const order = topics().map((t) => t.topic);
  const filtering = Boolean(cardsView.query) || cardsView.filter !== "all" || cardsView.hiddenTopics.size > 0
    || cardsView.hiddenChannels.size > 0 || cardsView.onlyDiagrams;
  const shownOf = (c) => turnOk(c) && rowMatches(c);
  let shown = 0;
  const rowsOf = (list) => list.map((c) => {
    const r = cardRow(c);
    r.hidden = !shownOf(c);
    if (!r.hidden) shown += 1;
    return r;
  });
  const makeGroup = (level, key, title, list, children) => {
    const visible = list.filter(shownOf);
    const g = group("card-group", `cards:${level}:${key}`, [title], statusPills(visible), filtering && visible.length > 0);
    g.dataset.level = level;
    g.hidden = visible.length === 0;
    const body = el("div", level === "concern" ? "group-body" : "group-body rows");
    body.append(...children);
    g.append(body);
    return g;
  };
  let tree;
  if (cardsView.group === "concern") {
    tree = concernNames().map((cn) => {
      const ts = order.filter((t) => concernOf(t) === cn);
      return makeGroup("concern", cn, cn, all.filter((c) => ts.includes(c.topic)), ts.map((t) => {
        const list = all.filter((c) => c.topic === t);
        return makeGroup("topic", t, topicTitle(t), list, rowsOf(list));
      }));
    });
  } else {
    const keyOf = (c) => (cardsView.group === "topic" ? topicTitle(c.topic)
      : cardsView.group === "idea" ? ideaTitle(c.unit, c.topic)
      : cardsView.group === "channel" ? CHANNEL[channelOf(c.channel)][1] : STATUS[c.status]);
    const rank = (c) => (cardsView.group === "topic" ? order.indexOf(c.topic)
      : cardsView.group === "idea" ? order.indexOf(c.topic) * 100 + (ideas().get(c.unit)?.n ?? 99)
      : cardsView.group === "channel" ? Object.keys(CHANNEL).indexOf(channelOf(c.channel)) : Object.keys(STATUS).indexOf(c.status));
    const groups = new Map();
    for (const c of [...all].sort((a, b) => rank(a) - rank(b))) {
      if (!groups.has(keyOf(c))) groups.set(keyOf(c), []);
      groups.get(keyOf(c)).push(c);
    }
    tree = [...groups].map(([name, list]) => makeGroup(cardsView.group, name, name, list, rowsOf(list)));
  }
  $("cards-list").replaceChildren(...tree);
  $("cards-empty").hidden = shown > 0 || !filtering;
  const pool = all.filter((c) => turnOk(c) && rowMatches(c, true));
  $("cards-filters").replaceChildren(...FILTERS.map((f) => {
    const b = el("button", f === cardsView.filter ? "on" : "");
    b.type = "button";
    b.dataset.filter = f;
    if (f !== "all") b.append(el("i", `dot ${f}`));
    b.append(f === "all" ? "All" : STATUS[f], el("em", "", String(pool.filter((c) => f === "all" || c.status === f).length)));
    b.addEventListener("click", () => { cardsView.filter = f; renderCards(); });
    return b;
  }));
  document.querySelectorAll("#cards-group button").forEach((b) => b.classList.toggle("on", b.dataset.group === cardsView.group));
  const n = cardsView.hiddenTopics.size + cardsView.hiddenChannels.size + (cardsView.onlyDiagrams ? 1 : 0);
  $("filter-count").hidden = !n;
  $("filter-count").textContent = String(n);
}

// ---------- Topics: concern -> topic -> core idea -> questions; "Builds on" / "Needed by" follow the idea links ----------
function ideaChip(unit, cls, from) {
  const idea = ideas().get(unit);
  const b = el("button", `chip ${cls}`);
  b.type = "button";
  b.dataset.unit = unit;
  const where = idea && idea.topic !== from ? ` · ${topicTitle(idea.topic)}` : "";
  b.append(idea ? `${idea.n}. ${idea.label}${where}` : unit);
  b.addEventListener("click", () => goToIdea(unit));
  return b;
}

function goToIdea(unit) {
  const target = document.querySelector(`.idea[data-unit="${CSS.escape(unit)}"]`);
  if (!target) return;
  openPath(target);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("flash");
  void target.offsetWidth;
  target.classList.add("flash");
}

function progressLine(list, read, total) {
  const known = list.filter((c) => c.status === "later").length;
  const learning = list.filter((c) => c.status === "learn" || c.status === "due").length;
  const box = el("div", "progress-line");
  const split = el("div", "split");
  for (const [cls, n] of [["k", known], ["l", learning], ["n", list.length - known - learning]]) {
    const i = el("i", cls);
    i.style.flex = String(n || 0.0001);
    split.append(i);
  }
  box.append(split, pills(pill("read", `${read}/${total}`, "read"), pill("known", known, "known"),
    pill("learning", learning, "learning")));
  return box;
}

function renderTopics() {
  const o = engine.overview(now());
  const all = cardList();
  renderTurns($("topics-turns"), all);
  const inTurn = all.filter(turnOk);
  const byIdea = [...ideas().values()];
  $("topics-list").replaceChildren(...concernNames().map((cn) => {
    const ts = topics().filter((t) => (t.concern || "Other") === cn);
    const mine = inTurn.filter((c) => ts.some((t) => t.topic === c.topic));
    const g = group("concern surface", `topics:c:${cn}`, [cn],
      pills(pill("topics", ts.length, "topics"), pill("questions", mine.length, "questions")));
    g.dataset.concern = cn;
    const body = el("div", "group-body");
    body.append(progressLine(mine, ts.filter((t) => o.read.includes(t.topic)).length, ts.length));
    body.append(...ts.map((t) => topicCard(t, all, o, byIdea)));
    g.append(body);
    return g;
  }));
}

function topicCard(t, all, o, byIdea) {
  const every = all.filter((c) => c.topic === t.topic);
  const mine = every.filter(turnOk);
  const read = o.read.includes(t.topic);
  const units = byIdea.filter((i) => i.topic === t.topic).sort((a, b) => a.n - b.n);
  const known = mine.filter((c) => c.status === "later").length;
  const card = group("topic-card", `topics:t:${t.topic}`,
    [el("b", "", t.title), el("span", "topic-state", read ? "Read" : "Not read yet")],
    pills(pill("ideas", units.length, "ideas"), read ? pill("known", `${known}/${mine.length}`, "known")
      : pill("questions", mine.length, "questions")));
  card.dataset.topic = t.topic;
  card.querySelector("summary").classList.add("topic-head");
  const body = el("div", "group-body");
  const actions = el("div", "stack2 topic-actions");
  const note = el("a", "btn quiet topic-note");
  note.href = `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${encodeURIComponent(t.note.replace(/\.md$/, ""))}`;
  note.append(ic("book"), "Read the note in Obsidian");
  actions.append(note);
  if (!read) {
    const mark = el("button", "btn primary", "I've read it · open its cards");
    mark.type = "button";
    mark.addEventListener("click", () => openTopic(t.topic));
    actions.append(mark);
  }
  body.append(actions);
  const rowsOf = (list) => {
    const rows = el("div", "rows idea-cards");
    rows.append(...list.map((c) => {
      const r = cardRow(c);
      r.hidden = !turnOk(c);
      return r;
    }));
    return rows;
  };
  for (const idea of units) {
    const qs = every.filter((c) => c.unit === idea.unit);
    const inTurn = qs.filter(turnOk);
    const box = group("idea", `topics:i:${idea.unit}`,
      [el("span", "idea-n", String(idea.n)), el("b", "", idea.label)],
      pills(pill("known", `${inTurn.filter((c) => c.status === "later").length}/${inTurn.length}`, "known")));
    box.dataset.unit = idea.unit;
    const ib = el("div", "group-body");
    ib.append(el("p", "idea-text", idea.idea));
    if (idea.requires.length) {
      const row = el("div", "chips-wrap");
      row.append(el("span", "chip-label", "Builds on"), ...idea.requires.map((r) => ideaChip(r.unit, "idea-req", t.topic)));
      ib.append(row);
    }
    const users = byIdea.filter((x) => x.requires.some((r) => r.unit === idea.unit));
    if (users.length) {
      const row = el("div", "chips-wrap");
      row.append(el("span", "chip-label", "Needed by"), ...users.map((x) => ideaChip(x.unit, "idea-for", t.topic)));
      ib.append(row);
    }
    ib.append(rowsOf(qs));
    box.append(ib);
    body.append(box);
  }
  const across = every.filter((c) => !ideas().has(c.unit));
  if (across.length) {
    const box = group("across", `topics:a:${t.topic}`, [el("b", "", "Across the topic")],
      pills(pill("questions", across.filter(turnOk).length, "questions")));
    const ab = el("div", "group-body");
    ab.append(rowsOf(across));
    box.append(ab);
    body.append(box);
  }
  card.append(body);
  return card;
}

function openFilters() {
  const box = (set, value, label, data) => {
    const l = el("label");
    const x = el("input");
    x.type = "checkbox";
    x.checked = !set.has(value);
    x.dataset[data] = value;
    x.addEventListener("change", () => { if (x.checked) set.delete(value); else set.add(value); renderCards(); });
    l.append(x, label);
    return l;
  };
  $("filter-topics").replaceChildren(...topics().map((t) => box(cardsView.hiddenTopics, t.topic, t.title, "topic")));
  $("filter-channels").replaceChildren(...Object.entries(CHANNEL).map(([k, [, label]]) => box(cardsView.hiddenChannels, k, label, "channel")));
  openSheet("filter-sheet");
}

// The card as in review, over the list; nothing is recorded.
function preview(id) {
  const item = engine.item(id);
  const flash = item.channel === "flashcard";
  const choice = item.channel === "choice" ? item.choice : null;
  const fronts = flash ? (item.card.fronts?.length ? item.card.fronts : [item.card.front])
    : choice ? [choice.versions[0].stem] : [item.example_prompt || ""];
  const choiceAnswer = choice && [...choice.versions[0].options.map((o) => (o.right ? `- ✓ **${o.text}**` : `- ✗ ${o.text}: ${o.trap}`)),
    "", `**Why**: ${choice.why}`].join("\n");
  $("preview-meta").textContent = `${CHANNEL[channelOf(item.channel)][1]} · ${topicTitle(id.split(".")[0])}`;
  rich($("preview-front"), fronts[0]);
  rich($("preview-back"), flash ? item.card.back : choice ? choiceAnswer : item.model_answer || "");
  $("preview-back-label").textContent = flash || choice ? "Answer" : "Model answer";
  $("preview-points").replaceChildren(...(item.must || []).map((m) => pointLi(m.point)));
  $("preview-why").hidden = !explanations().has(id);
  $("preview-why").onclick = () => openExplain(item, false);
  $("preview-back-box").hidden = true;
  $("preview-reveal").hidden = false;
  $("preview-ai").hidden = flash || Boolean(choice);
  const aside = cardList().find((c) => c.id === id)?.status === "aside";
  $("preview-aside").textContent = aside ? "Bring back" : "Not now: set aside";
  $("preview-aside").onclick = () => setAside(id, $("preview-aside").textContent !== "Bring back");
  $("preview").hidden = false;
  $("preview").scrollTop = 0;
}

// ---------- Progress ----------
function renderProgress() {
  const o = engine.overview(now());
  const every = cardList();
  renderTurns($("progress-turns"), every);
  const all = every.filter(turnOk);
  const week = Object.values(o.per_day).reduce((a, b) => a + b, 0);
  $("week-answers").textContent = String(week);
  $("known-total").textContent = String(all.filter((c) => c.status === "later").length);
  const split = (known, learning, rest) => {
    const s = el("div", "split");
    for (const [cls, n] of [["k", known], ["l", learning], ["n", rest]]) {
      const i = el("i", cls);
      i.style.flex = String(n || 0.0001);
      s.append(i);
    }
    return s;
  };
  const counts = (list) => {
    const known = list.filter((c) => c.status === "later").length;
    const learning = list.filter((c) => c.status === "learn" || c.status === "due").length;
    return [known, learning, list.length - known - learning];
  };
  $("topics").replaceChildren(...concernNames().map((cn) => {
    const ts = topics().filter((t) => (t.concern || "Other") === cn);
    const mine = all.filter((c) => ts.some((t) => t.topic === c.topic));
    const [known, learning, rest] = counts(mine);
    const g = group("progress-concern surface", `progress:c:${cn}`, [cn],
      pills(pill("known", `${known}/${mine.length}`, "known"), learning > 0 && pill("learning", learning, "learning")));
    g.dataset.concern = cn;
    const body = el("div", "group-body");
    body.append(split(known, learning, rest), ...ts.map((t) => {
      const list = all.filter((c) => c.topic === t.topic);
      const [k, l, r] = counts(list);
      const div = el("div", "topic topic-progress");
      Object.assign(div.dataset, { topic: t.topic, total: list.length, known: k, learning: l });
      const h = el("h3", "", t.title);
      h.append(o.read.includes(t.topic) ? pills(pill("known", `${k}/${list.length}`, "known"))
        : el("span", "", "not read yet"));
      div.append(h, split(k, l, r));
      return div;
    }));
    g.append(body);
    return g;
  }));
  const max = Math.max(1, ...Object.values(o.per_day));
  $("per-day").replaceChildren(...Object.entries(o.per_day).map(([d, n]) => {
    const col = el("div");
    const bar = el("i", n ? "" : "zero");
    bar.style.height = `${(n / max) * 70 + 6}px`;
    col.title = `${d}: ${n}`;
    col.append(bar, "SMTWTFS"[new Date(`${d}T12:00:00Z`).getUTCDay()]);
    return col;
  }));
}

// ---------- Settings ----------
function applyTheme() {
  const choice = localStorage.getItem(THEME_KEY) || "system";
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.classList.toggle("on", b.dataset.themeChoice === choice));
}

// ---------- wiring ----------
document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
$("start").addEventListener("click", () => {
  session = { done: 0 };
  setState(showCard());
  show("practice");
});
$("practice-close").addEventListener("click", () => show("today"));
$("done-home").addEventListener("click", () => show("today"));
$("next-topic").addEventListener("click", () => openTopic($("next-topic").dataset.topic));
$("mark-read").addEventListener("click", () => markRead($("mark-read").dataset.topic));
$("veil").addEventListener("click", closeSheets);
$("reveal").addEventListener("click", () => {
  $("card-flip").classList.add("flipped");
  $("card-back").hidden = false;
  $("card-points-box").hidden = !$("card-points").children.length;
  $("ratings").hidden = false;
  $("reveal").hidden = true;
  $("why").hidden = !(current && explanations().has(current.id));
});
$("why").addEventListener("click", () => { if (current) openExplain(current.item, false); });
$("explain-next").addEventListener("click", closeExplain);
$("explain-back").addEventListener("click", closeExplain);
$("explain-close").addEventListener("click", closeExplain);
$("diagram-close").addEventListener("click", () => { $("diagram-view").hidden = true; });
$("zoom-in").addEventListener("click", () => setZoom(zoom * 1.5));
$("zoom-out").addEventListener("click", () => setZoom(zoom / 1.5));
// "Did you know it?" then "How did it come?": Again, or Hard / Good / Easy
$("know-no").addEventListener("click", () => rate(1));
$("choice-continue").addEventListener("click", () => rate(1));
// a right turn-2 pick: the reason is saved and graded in the next Claude session; Good until then
$("reason-save").addEventListener("click", () => {
  const reason = $("reason-text").value.trim();
  if (!reason || !current) return $("reason-text").focus();
  current.reason = reason;
  rate(3);
});
$("know-yes").addEventListener("click", () => { $("know").hidden = true; $("came").hidden = false; });
$("came-back").addEventListener("click", () => { $("came").hidden = true; $("know").hidden = false; });
$("came-effort").addEventListener("click", () => rate(2));
$("came-moment").addEventListener("click", () => rate(3));
$("came-instantly").addEventListener("click", () => rate(4));
$("flag-heavy").addEventListener("click", () => {
  const on = $("flag-heavy").getAttribute("aria-pressed") !== "true";
  $("flag-heavy").setAttribute("aria-pressed", String(on));
});
$("cards-search").addEventListener("input", () => { cardsView.query = $("cards-search").value.trim().toLowerCase(); renderCards(); });
document.querySelectorAll("#cards-group button").forEach((b) => b.addEventListener("click", () => {
  cardsView.group = b.dataset.group;
  renderCards();
}));
$("open-filters").addEventListener("click", openFilters);
$("filter-done").addEventListener("click", closeSheets);
$("filter-clear").addEventListener("click", () => {
  cardsView.hiddenTopics.clear();
  cardsView.hiddenChannels.clear();
  cardsView.onlyDiagrams = false;
  $("filter-diagrams").checked = false;
  closeSheets();
  renderCards();
});
$("filter-diagrams").addEventListener("change", () => { cardsView.onlyDiagrams = $("filter-diagrams").checked; renderCards(); });
$("update").addEventListener("click", () => location.reload());
$("preview-reveal").addEventListener("click", () => { $("preview-back-box").hidden = false; $("preview-reveal").hidden = true; });
$("preview-close").addEventListener("click", () => { $("preview").hidden = true; });
document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => {
  localStorage.setItem(THEME_KEY, b.dataset.themeChoice);
  applyTheme();
}));
$("change-token").addEventListener("click", () => { openToken(); $("token").focus(); });
document.querySelectorAll("#turn-choice button").forEach((b) => b.addEventListener("click", () => setTurn(Number(b.dataset.setTurn))));
$("turn-next").addEventListener("click", () => setTurn(Number($("turn-next").dataset.turn)));
$("not-now").addEventListener("click", () => current && setAside(current.id, true));
$("token-warning").addEventListener("click", () => { openToken(); $("token").focus(); });
$("token-cancel").addEventListener("click", closeToken);
$("sync").addEventListener("click", () => save());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && applied.length) save();
  if (document.visibilityState === "visible") checkVersion();
});
$("token-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const token = $("token").value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  const expires = $("token-expires").value;
  if (expires) localStorage.setItem(TOKEN_EXPIRES_KEY, expires);
  else localStorage.removeItem(TOKEN_EXPIRES_KEY);
  $("token").value = "";
  closeToken();
  renderToken();
  if (!engine) setState("loading");
  else setState(current ? "ready" : "done");
  await save();
});

(async () => {
  applyTheme();
  renderToken();
  renderSettings();
  checkVersion();
  await keepStorage();
  await showPending();
  enginePromise = Engine.start();
  enginePromise.catch((e) => setState("error", `Python did not start (${e.message})`));
  if (!localStorage.getItem(TOKEN_KEY)) return setState("no-token");
  setState("loading");
  const snap = await snapshotGet();
  if (snap?.repo === `${API}/${REPO}`) {
    await loadBase(snap);
    setState(showCard());
    render();
  }
  await save();
})();
