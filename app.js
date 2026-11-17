import { GitHub, Offline, BadToken, Conflict } from "./github.js";
import { Engine, STATE_DIR } from "./engine.js";
import { outboxAll, outboxPut, outboxDelete, keepStorage, snapshotGet, snapshotPut } from "./store.js";

const params = new URLSearchParams(location.search);
const onThisComputer = ["localhost", "127.0.0.1"].includes(location.hostname);
// the api override would let a crafted link receive the token, so it only works on a local test server
const API = (onThisComputer && params.get("api")) || "https://api.github.com";
const REPO = params.get("repo") || "MiguelLopezVirues/pca-study";
const TOKEN_KEY = "pca-token";
const THEME_KEY = "pca-theme";
const VAULT = "vault";  // the vault name Obsidian shows on the phone (the GitSync copy of pca-study/vault)
const ANSWERS = `${STATE_DIR}/answers.jsonl`;
const TOPICS = "pilot/practice/topics.json";
const READ_DIRS = ["pilot/practice/items", STATE_DIR];
const READ_FILES = ["graph-tools/tsv_write.py", "pilot/idea_links.tsv", "pilot/relevance_final.tsv",
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
const CHANNEL = { flashcard: ["card", "Self-graded"], choice: ["choice", "Choice + why"], ai: ["pen", "Open · AI"] };
const STATUS = { due: "Due now", new: "New", learn: "Learning", later: "Later", ai: "Needs AI", locked: "Opens later" };
const FILTERS = ["all", "due", "new", "learn", "ai", "later", "locked"];

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
const cardsView = { query: "", filter: "all", group: "topic", hiddenTopics: new Set(), hiddenChannels: new Set() };

const now = () => new Date().toISOString();
const channelOf = (c) => (CHANNEL[c] ? c : "ai");
const topics = () => {
  try { return JSON.parse(base?.files?.[TOPICS] || "[]"); } catch { return []; }
};
const topicTitle = (id) => topics().find((t) => t.topic === id)?.title || id;

function setState(state, detail = "") {
  $("status").dataset.state = state;
  $("status").textContent = LABELS[state] + (detail ? `: ${detail}` : "");
  $("token-form").hidden = !["token-expired", "no-token"].includes(state);
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
  return JSON.stringify({ id: a.id, item: a.item, rating: a.rating, time: a.time, minutes: a.minutes,
    prompt: a.prompt || "card:1", ...(a.flags ? { flags: a.flags } : {}), ...(a.ticked ? { ticked: a.ticked } : {}) }) + "\n";
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
  for (const v of ["today", "practice", "cards", "progress", "settings"]) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  render();
}

function render() {
  if (!engine || !base) return;
  if (tab === "today") renderToday();
  else if (tab === "cards") renderCards();
  else if (tab === "progress") renderProgress();
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
  $("veil").classList.remove("open");
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
  openSheet("topic-sheet");
}

async function markRead(topicId) {
  closeSheets();
  await keep({ id: crypto.randomUUID(), type: "read", topic: topicId, time: now() }, true);
  if (tab !== "practice") setState(showCard());
  render();
}

// ---------- practice ----------
function showCard() {
  const due = engine.flashcards(now());
  $("card-flip").classList.remove("flipped");
  $("card-back").hidden = true;
  $("ratings").hidden = true;
  $("know").hidden = false;
  $("came").hidden = true;
  $("reveal").hidden = false;
  const left = due.length;
  $("bar").style.width = `${(session.done / Math.max(1, session.done + left)) * 100}%`;
  if (!due.length) {
    current = null;
    $("card").hidden = true;
    $("done").hidden = false;
    return "done";
  }
  const item = engine.item(due[0]);
  const fronts = item.card.fronts?.length ? item.card.fronts : [item.card.front];
  const k = engine.reviewsOf(item.id) % fronts.length;
  current = { id: item.id, shown: Date.now(), prompt: `card:${k + 1}` };
  $("flag-heavy").setAttribute("aria-pressed", "false");
  $("card-topic").textContent = `${CHANNEL.flashcard[1]} · ${topicTitle(item.id.split(".")[0])}`;
  $("card-front").textContent = fronts[k];
  $("card-back").textContent = item.card.back;
  $("card-points").replaceChildren(...(item.must || []).map((m) => {
    const li = el("li");
    li.setAttribute("role", "checkbox");
    li.setAttribute("aria-checked", "false");
    li.tabIndex = 0;
    const box = el("span", "box");
    box.append(ic("check"));
    li.append(box, el("span", "", m.point));
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
  const ticked = [...$("card-points").children].flatMap((li, n) => (li.getAttribute("aria-checked") === "true" ? [n] : []));
  if (ticked.length) answer.ticked = ticked;
  current = null;
  session.done += 1;
  await outboxPut(answer);
  engine.record(answer);
  applied.push(answer);
  const state = showCard();
  setState(state);
  await showPending();
  scheduleSave(state === "done");
}

// ---------- Cards ----------
function rowMatches(c, ignoreStatus = false) {
  const q = cardsView.query;
  return (!q || c.text.toLowerCase().includes(q) || topicTitle(c.topic).toLowerCase().includes(q))
    && !cardsView.hiddenTopics.has(c.topic) && !cardsView.hiddenChannels.has(channelOf(c.channel))
    && (ignoreStatus || cardsView.filter === "all" || c.status === cardsView.filter);
}

function statusTag(status, due) {
  const sp = el("span", "status");
  sp.append(el("i", `dot ${status}`));
  let label = STATUS[status];
  if (status === "later" && due) label = `Next ${new Date(due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  sp.append(label);
  return sp;
}

function renderCards() {
  const all = engine.cardList(now());
  const order = topics().map((t) => t.topic);
  const keyOf = (c) => (cardsView.group === "topic" ? topicTitle(c.topic)
    : cardsView.group === "channel" ? CHANNEL[channelOf(c.channel)][1] : STATUS[c.status]);
  const rank = (c) => (cardsView.group === "topic" ? order.indexOf(c.topic)
    : cardsView.group === "channel" ? Object.keys(CHANNEL).indexOf(channelOf(c.channel)) : Object.keys(STATUS).indexOf(c.status));
  const groups = new Map();
  for (const c of [...all].sort((a, b) => rank(a) - rank(b))) {
    if (!groups.has(keyOf(c))) groups.set(keyOf(c), []);
    groups.get(keyOf(c)).push(c);
  }
  let shown = 0;
  $("cards-list").replaceChildren(...[...groups].flatMap(([name, list]) => {
    const sec = el("div", "surface rows");
    for (const c of list) {
      const row = el("button", "rowi card-row");
      row.type = "button";
      Object.assign(row.dataset, { item: c.id, status: c.status, topic: c.topic, channel: channelOf(c.channel) });
      const icon = el("div", "ic");
      icon.append(ic(CHANNEL[channelOf(c.channel)][0]));
      const tx = el("div", "tx");
      tx.append(el("p", "", c.text), statusTag(c.status, c.due));
      const chev = el("span", "chev");
      chev.append(ic("eye"));
      row.append(icon, tx, chev);
      row.hidden = !rowMatches(c);
      if (!row.hidden) shown += 1;
      row.addEventListener("click", () => preview(c.id));
      sec.append(row);
    }
    const label = el("div", "label", name);
    sec.hidden = label.hidden = list.every((c) => !rowMatches(c));
    return [label, sec];
  }));
  $("cards-empty").hidden = shown > 0;
  const pool = all.filter((c) => rowMatches(c, true));
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
  const n = cardsView.hiddenTopics.size + cardsView.hiddenChannels.size;
  $("filter-count").hidden = !n;
  $("filter-count").textContent = String(n);
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
  const fronts = flash ? (item.card.fronts?.length ? item.card.fronts : [item.card.front]) : [item.example_prompt || ""];
  $("preview-meta").textContent = `${CHANNEL[channelOf(item.channel)][1]} · ${topicTitle(id.split(".")[0])}`;
  $("preview-front").textContent = fronts[0];
  $("preview-back").textContent = flash ? item.card.back : "";
  $("preview-points").replaceChildren(...(flash ? item.must || [] : []).map((m) => el("li", "", m.point)));
  $("preview-back-box").hidden = true;
  $("preview-reveal").hidden = !flash;
  $("preview-ai").hidden = flash;
  $("preview").hidden = false;
}

// ---------- Progress ----------
function renderProgress() {
  const o = engine.overview(now());
  const all = engine.cardList(now());
  const week = Object.values(o.per_day).reduce((a, b) => a + b, 0);
  $("week-answers").textContent = String(week);
  $("known-total").textContent = String(all.filter((c) => c.status === "later").length);
  $("topics").replaceChildren(...topics().map((t) => {
    const mine = all.filter((c) => c.topic === t.topic);
    const known = mine.filter((c) => c.status === "later").length;
    const learning = mine.filter((c) => c.status === "learn" || (c.status === "due")).length;
    const rest = mine.length - known - learning;
    const div = el("div", "topic topic-progress");
    Object.assign(div.dataset, { topic: t.topic, total: mine.length, known, learning });
    const h = el("h3", "", t.title);
    h.append(el("span", "", o.read.includes(t.topic) ? `${known} of ${mine.length} known` : "not read yet"));
    const split = el("div", "split");
    for (const [cls, n] of [["k", known], ["l", learning], ["n", rest]]) {
      const i = el("i", cls);
      i.style.flex = String(n || 0.0001);
      split.append(i);
    }
    div.append(h, split);
    return div;
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
});
// "Did you know it?" then "How did it come?": Again, or Hard / Good / Easy
$("know-no").addEventListener("click", () => rate(1));
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
  closeSheets();
  renderCards();
});
$("preview-reveal").addEventListener("click", () => { $("preview-back-box").hidden = false; $("preview-reveal").hidden = true; });
$("preview-close").addEventListener("click", () => { $("preview").hidden = true; });
document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => {
  localStorage.setItem(THEME_KEY, b.dataset.themeChoice);
  applyTheme();
}));
$("change-token").addEventListener("click", () => { $("token-form").hidden = false; $("token").focus(); });
$("sync").addEventListener("click", () => save());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && applied.length) save();
});
$("token-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const token = $("token").value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  $("token").value = "";
  if (!engine) setState("loading");
  else setState(current ? "ready" : "done");
  $("token-form").hidden = true;
  await save();
});

(async () => {
  applyTheme();
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
