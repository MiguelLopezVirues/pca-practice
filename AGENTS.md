# pca-practice: notes for agents

Mobile-first static web app that runs `pca-study/pilot/practice/engine.py` via Pyodide and syncs flashcard/choice answers to `pca-study/pilot/practice/state/` on GitHub.

Follow `.agents/skills/pca-practice-app/SKILL.md` for architecture, `pytest` testing against `tests/fake_github.py`, `stamp.py` version bumping before release, Okabe-Ito colorblind-safe UI rules, and cross-repo safety (never write to `pca-study/pilot/practice/state/`).
