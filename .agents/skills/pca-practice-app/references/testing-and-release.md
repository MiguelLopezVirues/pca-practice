# Testing & Release

## Running Tests

Tests run against `tests/fake_github.py` and a copy of `pca-study` (`PCA_STUDY_DIR` env var or sibling `../pca-study`), never touching live GitHub state:

```bash
pytest
```

(`pytest.ini` configures `testpaths = tests` and `pythonpath = tests`.)

## Release Versioning

Before committing any JS, HTML, or CSS change, bump the version so phones detect `version.json` and offer a reload:

```bash
python3 stamp.py YYYY-MM-DD.N
```

This updates `version.json`, `const VERSION` in `app.js`, and all `?v=` query strings across `index.html`, `app.js`, `github.js`, `engine.js`, and `store.js`.
