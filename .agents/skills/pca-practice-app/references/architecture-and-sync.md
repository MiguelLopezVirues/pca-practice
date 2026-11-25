# Architecture & Sync

## Files

| File | Responsibility |
|---|---|
| `index.html`, `style.css`, `theme.js` | Layout, responsive mobile UI, Okabe-Ito theme variables |
| `app.js` | Screens (`Today`, `Cards`, `Progress`, `Settings`), outbox queue, `Conflict` retry loop |
| `engine.js` | Loads Pyodide + vendored `fsrs` wheels (`vendor/`) and wraps `pilot/practice/engine.py` |
| `github.js` | GitHub Git Data API client (`trees`, `blobs`, `commits`, fast-forward `PATCH`) |
| `store.js` | IndexedDB cache (`tree:`, `blob:`, snapshots, outbox) |
| `rich.js` | Markdown, callout, and SVG rendering for explanations |
| `stamp.py` | Release version stamper (`version.json`, `VERSION` in `app.js`, `?v=` query strings) |

## Design & Sync Notes

- Keep UI/UX decisions aligned with `../pca-study/vault/20 - Projects/PCA - Practice system/PCA - Practice decisions.md`.
- `app.js` handles non-state concurrent commits on `pca-study` `main` by catching `Conflict` (`HTTP 422`), reloading `head`, replaying the outbox, and retrying.
- If stored engine state in IndexedDB fails to load, `app.js` drops the broken snapshot and reloads fresh from GitHub.
