---
name: pca-practice-app
description: Develop, test, and release the pca-practice phone web app (UI, Pyodide engine bridge, GitHub API sync, and offline store). Use when modifying files in MiguelLopezVirues/pca-practice, debugging phone sync or rendering, running the page test suite, or stamping a release version.
---

# PCA Practice Web App

Mobile-first static web app running `pca-study/pilot/practice/engine.py` in Pyodide and syncing answers to `pca-study/pilot/practice/state/` on GitHub.

## Always-On Rules

1. **Cross-repo safety**: Never write to `pca-study/pilot/practice/state/`. If a change alters question schemas or `engine.py` contracts, coordinate with the `pca-study-workflow` skill.
2. **Accessibility**: Use Okabe-Ito colors paired with a second visual cue (icon, dash, or text label) for red/green colorblindness.
3. **Engineering hygiene**: Tests first (red, then green); LF line endings; explicit-path commits; no AI attribution in commit messages.

## Reference Index (load only the concern you need)

| Concern | Reference file | Read when… |
|---|---|---|
| Architecture & sync | `references/architecture-and-sync.md` | Editing JS/HTML/CSS, debugging Pyodide loading, GitHub API sync, or IndexedDB caching |
| Testing & release | `references/testing-and-release.md` | Running `pytest` (`fake_github.py`), bumping `stamp.py`, or preparing a release |
