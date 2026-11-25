"""Copying a question's ID and prompt to ask about it without showing IDs on screen.

Contract:
- Practice front (`#card-copy`), practice back (`#card-copy-back`), Cards preview (`#preview-copy`), and the
  explanation reader (`#explain-copy`) each have a Copy button.
- Tapping any of them copies `<item id>\\n<question text>` to the clipboard and briefly confirms "Copied"
  (`data-copied="true"`). The item ID itself is not shown on the card.
- In the explanation reader after rating No or With effort, `#explain-copy` still copies the explained item
  (not the next card waiting behind it).
"""
from __future__ import annotations

from conftest import T0, click_row, desktop_queue, items_by_id, open_page, plain
from test_page import fronts_of


def _grant_clipboard(context, origin):
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin)


def _clipboard(page):
    return page.evaluate("() => navigator.clipboard.readText()")


def test_practice_front_and_back_copy_the_card_reference(context, page_origin, repo, tmp_path):
    _grant_clipboard(context, page_origin)
    seed = repo.files()
    items = items_by_id(seed)
    first = next(i for i in desktop_queue(seed, T0, tmp_path) if items[i]["channel"] == "flashcard")
    page = open_page(context, page_origin, repo)
    assert first not in page.locator("#card").inner_text()
    assert page.locator("#card-copy").is_visible()
    page.click("#card-copy")
    page.wait_for_selector("#card-copy[data-copied='true']")
    assert "Copied" in page.locator("#card-copy").inner_text()
    copied = _clipboard(page)
    assert copied.startswith(first + "\n")
    assert plain(fronts_of(items[first])[0]) in plain(copied)

    page.click("#reveal")
    page.wait_for_selector("#card-copy-back", state="visible")
    page.click("#card-copy-back")
    page.wait_for_selector("#card-copy-back[data-copied='true']")
    assert _clipboard(page) == copied


def test_explain_copy_keeps_the_answered_card_after_no(context, page_origin, repo, tmp_path):
    _grant_clipboard(context, page_origin)
    seed = repo.files()
    items = items_by_id(seed)
    first = next(i for i in desktop_queue(seed, T0, tmp_path) if items[i]["channel"] == "flashcard")
    page = open_page(context, page_origin, repo)
    page.click("#reveal")
    page.click("#know-no")
    page.wait_for_selector("#explain-view", state="visible")
    assert page.locator("#explain-copy").is_visible()
    page.click("#explain-copy")
    page.wait_for_selector("#explain-copy[data-copied='true']")
    copied = _clipboard(page)
    assert copied.startswith(first + "\n")
    assert plain(fronts_of(items[first])[0]) in plain(copied)


def test_preview_copies_an_open_question_reference(context, page_origin, repo):
    _grant_clipboard(context, page_origin)
    seed = repo.files()
    items = items_by_id(seed)
    ai = next(i for i, it in items.items() if it["channel"] == "ai")
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='cards']")
    click_row(page, ai)
    assert ai not in page.locator("#preview").inner_text()
    assert page.locator("#preview-copy").is_visible()
    page.click("#preview-copy")
    page.wait_for_selector("#preview-copy[data-copied='true']")
    copied = _clipboard(page)
    assert copied.startswith(ai + "\n")
    assert plain(items[ai]["example_prompt"]) in plain(copied)
