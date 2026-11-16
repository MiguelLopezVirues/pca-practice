import { GitHub, Offline, BadToken, Conflict } from "./github.js";
import { Engine, STATE_DIR } from "./engine.js";
import { outboxAll, outboxPut, outboxDelete, keepStorage, snapshotGet, snapshotPut } from "./store.js";

const params = new URLSearchParams(location.search);
const onThisComputer = ["localhost", "127.0.0.1"].includes(location.hostname);
// the api override would let a crafted link receive the token, so it only works on a local test server
const API = (onThisComputer && params.get("api")) || "https://api.github.com";
const REPO = params.get("repo") || "MiguelLopezVirues/pca-study";
const TOKEN_KEY = "pca-token";
const ANSWERS = `${STATE_DIR}/answers.jsonl`;
const READ_DIRS = ["pilot/practice/items", STATE_DIR];
const READ_FILES = ["graph-tools/tsv_write.py", "pilot/idea_links.tsv", "pilot/relevance_final.tsv",
  "pilot/practice/engine.py", "pilot/practice/config.json"];
const MAX_TRIES = 4;
const SAVE_EVERY = 5;
const SAVE_IDLE_MS = 30_000;

const $ = (id) => document.getElementById(id);
const LABELS = {
  loading: "Loading…", ready: "Ready", done: "Done for now", offline: "Offline",
  "token-expired": "Token not accepted: enter a new one", "no-token": "Enter your token", error: "Something went wrong",
};
const SYNC_LABELS = { idle: "Saved", saving: "Saving…", offline: "Offline", "token-expired": "Not saved", error: "Not saved" };

let engine;
let enginePromise;
let current = null;
let base = null;      // the GitHub version the engine state builds on: {repo, commit, tree, files}
let baseLog = "";     // answers.jsonl in that version
let applied = [];     // answers recorded in the engine on top of base, oldest first
let saving = null;
let saveAgain = false;
let idleTimer;

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
  return JSON.stringify({ id: a.id, item: a.item, rating: a.rating, time: a.time, minutes: a.minutes,
    prompt: a.prompt || "card:1" }) + "\n";
}

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

async function commitApplied(gh) {
  const batch = applied.slice();
  const log = baseLog + batch.map(logLine).join("");
  const files = { ...engine.stateFiles(), [ANSWERS]: log };
  const message = batch.length === 1
    ? `practice: ${batch[0].item} rated ${batch[0].rating} (phone)`
    : `practice: ${batch.length} answers (phone)`;
  const saved = await gh.commit(base, files, message);
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

function scheduleSave(now) {
  clearTimeout(idleTimer);
  if (now || applied.length >= SAVE_EVERY) save();
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

function showCard() {
  const due = engine.flashcards(new Date().toISOString());
  $("card-back").hidden = true;
  $("ratings").hidden = true;
  $("came").hidden = true;
  $("reveal").hidden = false;
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
  $("card-front").textContent = fronts[k];
  $("card-back").textContent = item.card.back;
  $("card-points").replaceChildren(...(item.must || []).map((m) => {
    const li = document.createElement("li");
    li.textContent = m.point;
    return li;
  }));
  $("card-points-box").hidden = true;
  $("card").hidden = false;
  $("done").hidden = true;
  return "ready";
}

// After a reload from GitHub: keep the card on screen if it is still due, otherwise show the next one.
function refreshCard() {
  const due = engine.flashcards(new Date().toISOString());
  if (current && due.includes(current.id)) return;
  setState(showCard());
}

async function rate(rating) {
  if (!current) return;
  const answer = {
    id: crypto.randomUUID(), item: current.id, rating, prompt: current.prompt,
    time: new Date().toISOString(), minutes: (Date.now() - current.shown) / 60000,
  };
  current = null;
  await outboxPut(answer);
  engine.record(answer);
  applied.push(answer);
  const state = showCard();
  setState(state);
  await showPending();
  scheduleSave(state === "done");
}

$("reveal").addEventListener("click", () => {
  $("card-back").hidden = false;
  $("card-points-box").hidden = !$("card-points").children.length;
  $("ratings").hidden = false;
  $("reveal").hidden = true;
});
// "Did you know it?" then "How did it come?": Again, or Hard / Good / Easy
$("know-no").addEventListener("click", () => rate(1));
$("know-yes").addEventListener("click", () => { $("came").hidden = false; });
$("came-effort").addEventListener("click", () => rate(2));
$("came-moment").addEventListener("click", () => rate(3));
$("came-instantly").addEventListener("click", () => rate(4));
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
  await save();
});

(async () => {
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
  }
  await save();
})();
