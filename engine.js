// Runs the study repository's own engine.py in Pyodide, on a copy of the repository files.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const WHEELS = ["vendor/fsrs-6.3.2-py3-none-any.whl", "vendor/typing_extensions-4.15.0-py3-none-any.whl"];
const ROOT = "/repo";
const PRACTICE = `${ROOT}/pilot/practice`;
export const STATE_DIR = "pilot/practice/state";
export const ENGINE_STATE = ["state.json", "reviews.tsv", "credits.tsv", "unlocks.tsv"];

const GLUE = `
import importlib.util, json, sys
from datetime import datetime, timedelta
sys.path.insert(0, "/vendor")
_eng = None
_mod = None

def load():
    global _eng, _mod
    spec = importlib.util.spec_from_file_location("engine", "${PRACTICE}/engine.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["engine"] = mod
    spec.loader.exec_module(mod)
    _mod = mod
    _eng = mod.Engine.load("${PRACTICE}")

# Questions practised on the phone: flashcards and multiple choice (from turn 2 with a reason graded later).
def _phone(it):
    return it["channel"] in ("flashcard", "choice")

def flashcards(now):
    t = datetime.fromisoformat(now)
    return json.dumps([i for i in _eng.queue(t) if _phone(_eng.items[i])])

def item(item_id):
    return json.dumps(_eng.items[item_id])

def reviews_of(item_id):
    return sum(1 for r in _eng.reviews if r["item"] == item_id)

def record(item_id, rating, now, minutes, prompt):
    _eng.record(item_id, int(rating), datetime.fromisoformat(now), prompt_id=prompt, minutes=round(float(minutes), 2))
    _eng.save("${PRACTICE}")

def mark_read(topic, now):
    warnings = _eng.mark_read(topic, datetime.fromisoformat(now))
    _eng.save("${PRACTICE}")
    return json.dumps(warnings or [])

def set_turn(turn, now):
    _eng.set_turn(int(turn), datetime.fromisoformat(now))
    _eng.save("${PRACTICE}")

# The ideas a topic builds on whose first questions have not passed yet.
def missing(topic):
    return json.dumps(sorted(_eng._missing(topic)))

# Today: flashcards due again and new, questions for an AI session, topics read, answers per day (last 7 days).
def overview(now):
    t = datetime.fromisoformat(now)
    q = _eng.queue(t)
    fc = [i for i in q if _phone(_eng.items[i])]
    days = [(t - timedelta(days=d)).date().isoformat() for d in range(6, -1, -1)]
    per_day = {d: 0 for d in days}
    for r in _eng.reviews:
        d = str(r.get("time", ""))[:10]
        if d in per_day:
            per_day[d] += 1
    return json.dumps({"due": sum(1 for i in fc if i in _eng.cards), "new": sum(1 for i in fc if i not in _eng.cards),
                       "ai": len(q) - len(fc), "read": list(_eng.read), "per_day": per_day, "turn": _eng.current_turn})

# Every question with its status: due | new | learn | later | ai | locked.
def card_list(now):
    from fsrs import State
    t = datetime.fromisoformat(now)
    q = set(_eng.queue(t))
    out = []
    for iid, it in _eng.items.items():
        c = _eng.cards.get(iid)
        fc = _phone(it)
        if iid in q:
            s = ("due" if c else "new") if fc else "ai"
        elif c is not None:
            s = "learn" if c.state in (State.Learning, State.Relearning) else "later"
        elif _eng._is_open(iid):
            s = "new" if fc else "ai"
        else:
            s = "locked"
        card = it.get("card") or {}
        fronts = card.get("fronts") or ([card["front"]] if card.get("front") else [])
        versions = (it.get("choice") or {}).get("versions") or []
        text = fronts[0] if fronts else versions[0]["stem"] if versions else it.get("example_prompt", "")
        out.append({"id": iid, "topic": _mod._topic(it), "unit": it["unit"], "channel": it["channel"], "status": s,
                    "text": text, "turn": it.get("turn") or (2 if it["depth"] >= 2 else 1),
                    "due": c.due.isoformat() if c else None})
    return json.dumps(out)
`;

export class Engine {
  static async start() {
    const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: PYODIDE });
    for (const url of WHEELS) {
      py.unpackArchive(await (await fetch(url)).arrayBuffer(), "zip", { extractDir: "/vendor" });
    }
    py.runPython(GLUE);
    return new Engine(py);
  }

  constructor(py) {
    this.py = py;
  }

  // files: {repo path: text}; the state directory is replaced by what files hold.
  load(files) {
    const fs = this.py.FS;
    const stateDir = `${ROOT}/${STATE_DIR}`;
    try {
      for (const name of fs.readdir(stateDir)) if (name !== "." && name !== "..") fs.unlink(`${stateDir}/${name}`);
    } catch { /* first load */ }
    for (const [path, text] of Object.entries(files)) {
      const full = `${ROOT}/${path}`;
      fs.mkdirTree(full.slice(0, full.lastIndexOf("/")));
      fs.writeFile(full, text);
    }
    fs.mkdirTree(stateDir);
    this.py.globals.get("load")();
  }

  flashcards(nowIso) {
    return JSON.parse(this.py.globals.get("flashcards")(nowIso));
  }

  item(id) {
    return JSON.parse(this.py.globals.get("item")(id));
  }

  reviewsOf(id) {
    return this.py.globals.get("reviews_of")(id);
  }

  record(answer) {
    if (answer.type === "read") {
      return JSON.parse(this.py.globals.get("mark_read")(answer.topic, answer.time));
    }
    if (answer.type === "turn") return this.py.globals.get("set_turn")(answer.turn, answer.time);
    this.py.globals.get("record")(answer.item, answer.rating, answer.time, answer.minutes, answer.prompt || "card:1");
  }

  overview(nowIso) {
    return JSON.parse(this.py.globals.get("overview")(nowIso));
  }

  cardList(nowIso) {
    return JSON.parse(this.py.globals.get("card_list")(nowIso));
  }

  missing(topic) {
    return JSON.parse(this.py.globals.get("missing")(topic));
  }

  stateFiles() {
    const out = {};
    for (const name of ENGINE_STATE) {
      const full = `${ROOT}/${STATE_DIR}/${name}`;
      try { out[`${STATE_DIR}/${name}`] = this.py.FS.readFile(full, { encoding: "utf8" }); } catch { /* not written */ }
    }
    return out;
  }
}
