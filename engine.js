// Runs the study repository's own engine.py in Pyodide, on a copy of the repository files.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const WHEELS = ["vendor/fsrs-6.3.2-py3-none-any.whl", "vendor/typing_extensions-4.15.0-py3-none-any.whl"];
const ROOT = "/repo";
const PRACTICE = `${ROOT}/pilot/practice`;
export const STATE_DIR = "pilot/practice/state";
export const ENGINE_STATE = ["state.json", "reviews.tsv", "credits.tsv", "unlocks.tsv"];

const GLUE = `
import importlib.util, json, sys
from datetime import datetime
sys.path.insert(0, "/vendor")
_eng = None

def load():
    global _eng
    spec = importlib.util.spec_from_file_location("engine", "${PRACTICE}/engine.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["engine"] = mod
    spec.loader.exec_module(mod)
    _eng = mod.Engine.load("${PRACTICE}")

def flashcards(now):
    t = datetime.fromisoformat(now)
    return json.dumps([i for i in _eng.queue(t) if _eng.items[i]["channel"] == "flashcard"])

def item(item_id):
    return json.dumps(_eng.items[item_id])

def reviews_of(item_id):
    return sum(1 for r in _eng.reviews if r["item"] == item_id)

def record(item_id, rating, now, minutes, prompt):
    _eng.record(item_id, int(rating), datetime.fromisoformat(now), prompt_id=prompt, minutes=round(float(minutes), 2))
    _eng.save("${PRACTICE}")
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
    this.py.globals.get("record")(answer.item, answer.rating, answer.time, answer.minutes, answer.prompt || "card:1");
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
