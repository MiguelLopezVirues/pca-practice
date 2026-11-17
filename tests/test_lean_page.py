"""Lean questions on the phone: flashcards and turn-1 multiple choice from items_lean, with explanations from the
saved documentation pages.

Contract:
- After a lean topic is read, its flashcards and its turn-1 multiple-choice questions are practised on the phone;
  its short-explanation questions count as "For AI".
- Multiple choice: `#card-front` shows the version's stem (versions in turn, prompt `choice:<n>`) and `#choice-options`
  four `.opt` buttons (`data-right="true"` on the right one). Tapping one marks the right option `.right` and a wrong
  pick `.wrong` with its `.trap` shown, and shows `#choice-why`.
  Right: "How did it come?" (`#came-*`) gives Easy / Good / Hard. Wrong: `#choice-continue` records Again and opens
  the explanation (`#explain-next` moves on).
- A lean question's explanation block links the saved documentation page (`10 - Notes/PCA sources/...`).
"""
from __future__ import annotations

import json
from urllib.parse import unquote

from conftest import T0, desktop_apply, items_by_id, open_page, plain, rate, save_now, seed_files, settle
from test_page import answers, serve_files

LEAN_TOPIC = "FND-virtualization"


def lean_files(tmp_path):
    files = seed_files(tmp_path)
    files.update(desktop_apply(files, [("read", LEAN_TOPIC, T0)], tmp_path))
    return files


def to_lean_card(page, items, channel, limit=40):
    """Rate other cards Good until a lean card of this channel shows; return its item id."""
    for _ in range(limit):
        front = plain(page.locator("#card-front").inner_text())
        match = next((i for i, it in items.items() if i.startswith(LEAN_TOPIC + ".") and it["channel"] == channel and (
            front in {plain(f) for f in it.get("card", {}).get("fronts", [])}
            or front in {plain(v["stem"]) for v in it.get("choice", {}).get("versions", [])})), None)
        if match:
            return match
        if page.locator("#choice-options").is_visible():
            page.click(".opt[data-right='true']")
            page.click("#came-moment")
            settle(page)
        else:
            rate(page, 3)
    raise AssertionError(f"no {channel} card of {LEAN_TOPIC}")


def test_lean_flashcard_explains_from_the_saved_documentation_page(context, page_origin, tmp_path):
    files = lean_files(tmp_path)
    items = items_by_id(files)
    r, server = serve_files(files)
    try:
        page = open_page(context, page_origin, r)
        item = to_lean_card(page, items, "flashcard")
        page.click("#reveal")
        page.click("#why")
        links = [unquote(a.get_attribute("href")) for a in page.locator("#explain a.explain-source").all()]
        assert links and all("file=10 - Notes/" in link for link in links)
        assert page.locator("#explain .explain-block").count() >= 1, item
    finally:
        server.shutdown()


def test_multiple_choice_right_answer_then_how_it_came(context, page_origin, tmp_path):
    files = lean_files(tmp_path)
    items = items_by_id(files)
    r, server = serve_files(files)
    try:
        page = open_page(context, page_origin, r)
        item = to_lean_card(page, items, "choice")
        assert page.locator("#choice-options .opt").count() == 4
        page.click(".opt[data-right='true']")
        assert page.locator(".opt.right").count() == 1 and page.locator(".opt.wrong").count() == 0
        assert page.locator("#choice-why").is_visible()
        page.click("#came-moment")
        settle(page)
        save_now(page)
        last = answers(r)[-1]
        assert (last["item"], last["rating"], last["prompt"]) == (item, 3, "choice:1")
    finally:
        server.shutdown()


def test_multiple_choice_wrong_answer_shows_the_trap_then_explains(context, page_origin, tmp_path):
    files = lean_files(tmp_path)
    items = items_by_id(files)
    r, server = serve_files(files)
    try:
        page = open_page(context, page_origin, r)
        item = to_lean_card(page, items, "choice")
        page.locator(".opt[data-right='false']").first.click()
        assert page.locator(".opt.wrong .trap").is_visible()
        assert page.locator(".opt.right").count() == 1
        page.click("#choice-continue")
        page.wait_for_selector("#explain-next", state="visible")
        page.click("#explain-next")
        settle(page)
        save_now(page)
        last = answers(r)[-1]
        assert (last["item"], last["rating"]) == (item, 1)
    finally:
        server.shutdown()
