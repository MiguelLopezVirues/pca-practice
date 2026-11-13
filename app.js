import { GitHub, Offline, BadToken, Conflict } from "./github.js";
import { Engine, STATE_DIR } from "./engine.js";
import { outboxAll, outboxPut, outboxDelete, keepStorage } from "./store.js";

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

const $ = (id) => document.getElementById(id);
const LABELS = {
  loading: "Loading…", saving: "Saving…", ready: "Ready", done: "Done for now",
  offline: "Offline: answers kept on this phone", "token-expired": "Token not accepted: enter a new one",
  "no-token": "Enter your token", error: "Something went wrong",
};

let engine;
let enginePromise;
let current = null;
let applied = new Set();

function setState(state, detail = "") {
  $("status").dataset.state = state;
  $("status").textContent = LABELS[state] + (detail ? `: ${detail}` : "");
  $("token-form").hidden = !["token-expired", "no-token"].includes(state);
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

// Load the repository into the engine, apply the answers still on the phone, save them in one commit.
async function sync() {
  const gh = github();
  for (let attempt = 1; ; attempt++) {
    const head = await gh.head();
    const files = await gh.read(head.tree, READ_DIRS, READ_FILES);
    engine ??= await enginePromise;
    engine.load(files);
    applied = new Set();
    const saved = answerIds(files[ANSWERS]);
    const outbox = (await outboxAll()).sort((a, b) => a.time.localeCompare(b.time));
    const done = outbox.filter((a) => saved.has(a.id)).map((a) => a.id);
    if (done.length) await outboxDelete(done);
    const todo = outbox.filter((a) => !saved.has(a.id));
    if (!todo.length) return;
    let log = files[ANSWERS] || "";
    for (const a of todo) {
      engine.record(a);
      applied.add(a.id);
      log += JSON.stringify({ id: a.id, item: a.item, rating: a.rating, time: a.time, minutes: a.minutes }) + "\n";
    }
    const message = todo.length === 1
      ? `practice: ${todo[0].item} rated ${todo[0].rating} (phone)`
      : `practice: ${todo.length} answers (phone)`;
    try {
      await gh.commit(head, { ...engine.stateFiles(), [ANSWERS]: log }, message);
      await outboxDelete(todo.map((a) => a.id));
      return;
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= MAX_TRIES) throw e;
    }
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
  current = { id: item.id, shown: Date.now() };
  $("card-front").textContent = item.card.front;
  $("card-back").textContent = item.card.back;
  $("card").hidden = false;
  $("done").hidden = true;
  return "ready";
}

function fail(e) {
  if (e instanceof Offline) return setState("offline");
  if (e instanceof BadToken) return setState("token-expired");
  console.error(e);
  setState("error", e.message);
}

async function syncAndShow() {
  try {
    await sync();
    setState(showCard());
  } catch (e) {
    if (engine && current === null && !(e instanceof BadToken)) {
      try { showCard(); } catch { /* engine not loaded yet */ }
    }
    fail(e);
  }
  await showPending();
}

async function rate(rating) {
  if (!current) return;
  setState("saving");
  const answer = {
    id: crypto.randomUUID(), item: current.id, rating,
    time: new Date().toISOString(), minutes: (Date.now() - current.shown) / 60000,
  };
  current = null;
  await outboxPut(answer);
  await showPending();
  try {
    await sync();
    setState(showCard());
  } catch (e) {
    fail(e);
    // keep practising on the phone; the answer stays in the outbox and is applied again at the next sync
    if (!(e instanceof BadToken) && engine) {
      try {
        if (!applied.has(answer.id)) { engine.record(answer); applied.add(answer.id); }
        showCard();
      } catch { /* shown at the next sync */ }
    }
  }
  await showPending();
}

$("reveal").addEventListener("click", () => {
  $("card-back").hidden = false;
  $("ratings").hidden = false;
  $("reveal").hidden = true;
});
// "Did you know it?" then "How did it come?": Again, or Hard / Good / Easy
$("know-no").addEventListener("click", () => rate(1));
$("know-yes").addEventListener("click", () => { $("came").hidden = false; });
$("came-effort").addEventListener("click", () => rate(2));
$("came-moment").addEventListener("click", () => rate(3));
$("came-instantly").addEventListener("click", () => rate(4));
$("token-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const token = $("token").value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  $("token").value = "";
  setState("loading");
  await syncAndShow();
});

(async () => {
  await keepStorage();
  await showPending();
  enginePromise = Engine.start();
  enginePromise.catch((e) => setState("error", `Python did not start (${e.message})`));
  if (!localStorage.getItem(TOKEN_KEY)) return setState("no-token");
  setState("loading");
  await syncAndShow();
})();
