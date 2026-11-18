// GitHub Git Data API: read the needed files (cached by object id) and save files in one commit.
import { cacheGet, cachePut } from "./store.js?v=2026-11-18.3";

export class Offline extends Error {}
export class BadToken extends Error {}
export class Conflict extends Error {}

export class GitHub {
  constructor(api, repo, token) {
    this.base = `${api}/repos/${repo}/git`;
    this.token = token;
  }

  async call(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.base}/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new Offline("network");
    }
    if (res.status === 401) throw new BadToken("token");
    if (res.status === 422 && method === "PATCH") throw new Conflict("not a fast forward");
    if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
    return res.json();
  }

  async ref() {
    return (await this.call("GET", "ref/heads/main")).object.sha;
  }

  async head() {
    const sha = await this.ref();
    const commit = await this.call("GET", `commits/${sha}`);
    return { commit: sha, tree: commit.tree.sha };
  }

  async tree(sha) {
    const hit = await cacheGet(`tree:${sha}`);
    if (hit) return hit;
    const t = (await this.call("GET", `trees/${sha}`)).tree;
    await cachePut(`tree:${sha}`, t);
    return t;
  }

  async blob(sha) {
    const hit = await cacheGet(`blob:${sha}`);
    if (hit !== undefined) return hit;
    const b = await this.call("GET", `blobs/${sha}`);
    const bytes = Uint8Array.from(atob(b.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    await cachePut(`blob:${sha}`, text);
    return text;
  }

  // dirs: directory paths whose files are wanted; files: single file paths. Returns {path: text}.
  async read(rootTree, dirs, files) {
    const out = {};
    const wanted = new Set(files);
    const want = (dir) => dirs.includes(dir) || [...wanted].some((f) => f.startsWith(dir + "/"))
      || dirs.some((d) => d.startsWith(dir + "/"));
    const walk = async (sha, prefix) => {
      for (const e of await this.tree(sha)) {
        const path = prefix ? `${prefix}/${e.path}` : e.path;
        if (e.type === "tree" && want(path)) await walk(e.sha, path);
        else if (e.type === "blob" && (wanted.has(path) || dirs.includes(prefix))) out[path] = await this.blob(e.sha);
      }
    };
    await walk(rootTree, "");
    return out;
  }

  async commit(head, files, message) {
    const tree = await this.call("POST", "trees", {
      base_tree: head.tree,
      tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
    });
    const commit = await this.call("POST", "commits", { message, tree: tree.sha, parents: [head.commit] });
    await this.call("PATCH", "refs/heads/main", { sha: commit.sha, force: false });
    return { commit: commit.sha, tree: tree.sha };
  }
}
