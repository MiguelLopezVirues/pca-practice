"""In-memory stand-in for the parts of GitHub's Git Data API the page uses."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _sha(kind: str, payload: bytes) -> str:
    return hashlib.sha1(kind.encode() + b"\0" + payload).hexdigest()


class FakeRepo:
    def __init__(self, owner="me", name="pca-study", token="good-token"):
        self.owner, self.name, self.token = owner, name, token
        self.objects: dict[str, tuple[str, object]] = {}
        self.head: str | None = None
        self.requests: list[tuple[str, str]] = []
        self.offline = False
        self.ref_delay = 0.0  # seconds before answering a read of the branch head
        self.lock = threading.Lock()
        # called once, right before the next ref update is applied (to simulate another device)
        self.before_next_ref_update = None

    # ---------- objects ----------
    def _put(self, kind, value) -> str:
        payload = value if kind == "blob" else json.dumps(value, sort_keys=True).encode()
        sha = _sha(kind, payload)
        self.objects[sha] = (kind, value)
        return sha

    def _tree_from_files(self, files: dict[str, bytes]) -> str:
        children: dict[str, dict] = {}
        blobs: dict[str, bytes] = {}
        for path, data in files.items():
            head, _, rest = path.partition("/")
            if rest:
                children.setdefault(head, {})[rest] = data
            else:
                blobs[head] = data
        entries = [{"path": n, "type": "blob", "mode": "100644", "sha": self._put("blob", d)} for n, d in blobs.items()]
        entries += [{"path": n, "type": "tree", "mode": "040000", "sha": self._tree_from_files(sub)}
                    for n, sub in children.items()]
        return self._put("tree", sorted(entries, key=lambda e: e["path"]))

    def _files_of_tree(self, tree_sha, prefix="") -> dict[str, bytes]:
        out = {}
        for e in self.objects[tree_sha][1]:
            if e["type"] == "blob":
                out[prefix + e["path"]] = self.objects[e["sha"]][1]
            else:
                out.update(self._files_of_tree(e["sha"], prefix + e["path"] + "/"))
        return out

    def _commit(self, tree, parents, message) -> str:
        return self._put("commit", {"tree": tree, "parents": parents, "message": message})

    # ---------- test helpers ----------
    def seed(self, files: dict[str, bytes], message="seed"):
        self.head = self._commit(self._tree_from_files(files), [], message)

    def files(self) -> dict[str, bytes]:
        return self._files_of_tree(self.objects[self.head][1]["tree"])

    def commits(self) -> list[dict]:
        out, sha = [], self.head
        while sha:
            c = self.objects[sha][1]
            out.append({"sha": sha, "message": c["message"], "parents": c["parents"]})
            sha = c["parents"][0] if c["parents"] else None
        return list(reversed(out))

    def changed_paths(self, commit_sha) -> set[str]:
        c = self.objects[commit_sha][1]
        new = self._files_of_tree(c["tree"])
        old = self._files_of_tree(self.objects[c["parents"][0]][1]["tree"]) if c["parents"] else {}
        return {p for p in set(new) | set(old) if new.get(p) != old.get(p)}

    def push_external(self, changes: dict[str, bytes], message="other device"):
        files = self.files()
        files.update(changes)
        self.head = self._commit(self._tree_from_files(files), [self.head], message)

    def count(self, method, pattern) -> int:
        return sum(1 for m, p in self.requests if m == method and re.search(pattern, p))

    # ---------- API ----------
    def _apply_tree(self, base_sha, entries):
        files = self._files_of_tree(base_sha) if base_sha else {}
        for e in entries:
            if e.get("sha") is None and "content" not in e:
                files.pop(e["path"], None)
            elif "content" in e:
                files[e["path"]] = e["content"].encode()
            else:
                files[e["path"]] = self.objects[e["sha"]][1]
        return self._tree_from_files(files)

    def _is_ancestor(self, old, new) -> bool:
        stack = [new]
        while stack:
            s = stack.pop()
            if s == old:
                return True
            stack += self.objects[s][1]["parents"]
        return False

    def handle(self, method, path, auth, body):
        base = f"/repos/{self.owner}/{self.name}/git/"
        if not path.startswith(base):
            return 404, {"message": "Not Found"}
        if auth not in (f"Bearer {self.token}", f"token {self.token}"):
            return 401, {"message": "Bad credentials"}
        rest = path[len(base):].split("?")[0]
        with self.lock:
            if method == "GET" and rest == "ref/heads/main":
                return 200, {"ref": "refs/heads/main", "object": {"sha": self.head, "type": "commit"}}
            if method == "GET" and rest.startswith("commits/"):
                c = self.objects.get(rest.split("/")[1])
                if not c:
                    return 404, {"message": "Not Found"}
                return 200, {"sha": rest.split("/")[1], "tree": {"sha": c[1]["tree"]}, "parents": [{"sha": p} for p in c[1]["parents"]]}
            if method == "GET" and rest.startswith("trees/"):
                sha = rest.split("/")[1]
                if sha not in self.objects:
                    return 404, {"message": "Not Found"}
                return 200, {"sha": sha, "tree": self.objects[sha][1], "truncated": False}
            if method == "GET" and rest.startswith("blobs/"):
                sha = rest.split("/")[1]
                if sha not in self.objects:
                    return 404, {"message": "Not Found"}
                data = self.objects[sha][1]
                return 200, {"sha": sha, "size": len(data), "encoding": "base64", "content": base64.b64encode(data).decode()}
            if method == "POST" and rest == "blobs":
                data = base64.b64decode(body["content"]) if body.get("encoding") == "base64" else body["content"].encode()
                return 201, {"sha": self._put("blob", data)}
            if method == "POST" and rest == "trees":
                base_tree = body.get("base_tree")
                return 201, {"sha": self._apply_tree(base_tree, body["tree"])}
            if method == "POST" and rest == "commits":
                return 201, {"sha": self._commit(body["tree"], body["parents"], body["message"])}
            if method == "PATCH" and rest == "refs/heads/main":
                hook, self.before_next_ref_update = self.before_next_ref_update, None
                if hook:
                    hook()
                new = body["sha"]
                if not body.get("force") and not self._is_ancestor(self.head, new):
                    return 422, {"message": "Update is not a fast forward"}
                self.head = new
                return 200, {"ref": "refs/heads/main", "object": {"sha": new}}
        return 404, {"message": "Not Found"}


class _Handler(BaseHTTPRequestHandler):
    repo: FakeRepo

    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-GitHub-Api-Version")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _do(self, method):
        if self.repo.offline:
            self.close_connection = True
            self.connection.close()
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        self.repo.requests.append((method, self.path))
        if method == "GET" and self.path.endswith("/git/ref/heads/main") and self.repo.ref_delay:
            time.sleep(self.repo.ref_delay)
        status, payload = self.repo.handle(method, self.path, self.headers.get("Authorization"), body)
        data = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._do("GET")

    def do_POST(self):
        self._do("POST")

    def do_PATCH(self):
        self._do("PATCH")


def serve(repo: FakeRepo):
    handler = type("Handler", (_Handler,), {"repo": repo})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
