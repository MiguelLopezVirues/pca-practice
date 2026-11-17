"""Formatted text, the explanation side, answers in the Cards preview, and the token sheet.

Contract:
- Card texts use a markdown subset rendered as DOM nodes: **bold** -> strong, `code` -> code, ==quote== -> mark,
  blank line -> paragraphs, "- " / "1. " lists, | tables |.
- After revealing, `#why` opens the reader `#explain-view` over the card, with `#explain`: one `.explain-block`
  per sheet block the key points quote, with `a.explain-source` (obsidian://open?vault=vault&file=<note without
  .md>#<heading>, encoded), the block with the quotes marked, and its diagrams as `img.diagram`. `#explain-back`
  closes it.
- No and With effort record the answer, then open the reader with `#explain-next`; the next card shows after it.
  Instantly and A moment go straight to the next card.
- The Cards preview shows the answer of every question (`#preview-reveal`): the back or the model answer, the key
  points, and `#preview-why`, which opens the same reader.
- Tapping a diagram opens `#diagram-view` with `#diagram-img`; `#zoom-in` / `#zoom-out` change its width;
  `#diagram-close` closes it.
- Settings `#change-token` opens `#token-form`; `#token-cancel` closes it. `#token-expires` (optional date) is kept;
  `#token-days` then says how many days are left.
"""
from __future__ import annotations

import json
from urllib.parse import unquote

from conftest import T0, desktop_queue, items_by_id, open_page, plain, settle
from test_page import fronts_of


def explain(files, item_id):
    for path, data in files.items():
        if path.startswith("pilot/practice/explain/"):
            o = json.loads(data)
            if item_id in o["items"]:
                return o, o["items"][item_id]
    raise KeyError(item_id)


def first_flashcard(files, tmp):
    items = items_by_id(files)
    return next(i for i in desktop_queue(files, T0, tmp) if items[i]["channel"] == "flashcard")


def test_bold_and_tables_are_drawn(context, page_origin, repo, tmp_path):
    seed = repo.files()
    items = items_by_id(seed)
    first = first_flashcard(seed, tmp_path)
    page = open_page(context, page_origin, repo)
    front = fronts_of(items[first])[0]
    assert page.locator("#card-front strong").count() == front.count("**") // 2
    assert "**" not in page.locator("#card-front").inner_text()
    table = next(i for i, it in items.items() if it["channel"] == "flashcard" and "|---" in it["card"]["back"]
                 and i.startswith("NF-stack-at-a-glance."))
    page.click("#practice-close")
    page.click("#tabs [data-tab='cards']")
    page.click(f".card-row[data-item='{table}']")
    page.click("#preview-reveal")
    assert page.locator("#preview-back table tr").count() == len([ln for ln in items[table]["card"]["back"].splitlines()
                                                                   if ln.startswith("|") and "---" not in ln])


def test_why_shows_the_quoted_blocks_of_the_sheet(context, page_origin, repo, tmp_path):
    seed = repo.files()
    first = first_flashcard(seed, tmp_path)
    topic, blocks = explain(seed, first)
    page = open_page(context, page_origin, repo)
    page.click("#reveal")
    assert not page.locator("#explain").is_visible()
    page.click("#why")
    assert page.locator("#explain .explain-block").count() == len(blocks)
    link = page.locator("#explain a.explain-source").first.get_attribute("href")
    target = topic["note"][:-3] + "#" + blocks[0]["heading"]
    assert link.startswith("obsidian://open?vault=vault&file=")
    assert unquote(link.split("&file=", 1)[1]) == target
    assert page.locator("#explain .explain-block").first.locator("mark").count() == blocks[0]["text"].count("==") // 2
    assert not page.locator("#explain-next").is_visible()
    page.click("#explain-back")
    assert not page.locator("#explain-view").is_visible()
    assert page.locator("#know-no").is_visible()


def test_no_records_then_explains_before_the_next_card(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    front = page.locator("#card-front").inner_text()
    page.click("#reveal")
    page.click("#know-no")
    page.wait_for_selector("#explain-next", state="visible")
    assert page.locator("#explain").is_visible()
    assert page.locator("#pending").get_attribute("data-count") == "1"
    assert page.locator("#card-front").inner_text() == front
    page.click("#explain-next")
    settle(page)
    assert page.locator("#card-front").inner_text() != front


def test_with_effort_explains_and_a_moment_does_not(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    page.click("#reveal")
    page.click("#know-yes")
    page.click("#came-effort")
    page.wait_for_selector("#explain-next", state="visible")
    page.click("#explain-next")
    page.click("#reveal")
    page.click("#know-yes")
    page.click("#came-moment")
    settle(page)
    assert not page.locator("#explain-next").is_visible()
    assert not page.locator("#explain").is_visible()


def test_preview_shows_the_answer_of_an_open_question_with_its_diagrams(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    item = next(i for i, it in items.items() if it["channel"] != "flashcard" and any(
        b["diagrams"] for b in explain(seed, i)[1]))
    _, blocks = explain(seed, item)
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='cards']")
    page.click(f".card-row[data-item='{item}']")
    assert plain(page.locator("#preview-front").inner_text()) == plain(items[item]["example_prompt"])
    page.click("#preview-reveal")
    assert plain(page.locator("#preview-back").inner_text()) == plain(items[item]["model_answer"])
    assert page.locator("#preview-points li").count() == len(items[item]["must"])
    page.click("#preview-why")
    assert page.locator("#explain-view").is_visible()
    assert page.locator("#explain .explain-block").count() == len(blocks)
    n = len({d for b in blocks for d in b["diagrams"]})
    imgs = page.locator("#explain img.diagram")
    assert imgs.count() == n
    imgs.first.scroll_into_view_if_needed()
    page.wait_for_function("() => document.querySelector('#explain img.diagram').naturalWidth > 0")
    imgs.first.click()
    assert page.locator("#diagram-view").is_visible()
    assert page.locator("#diagram-img").get_attribute("src").startswith("blob:")
    before = page.locator("#diagram-img").bounding_box()["width"]
    page.click("#zoom-in")
    assert page.locator("#diagram-img").bounding_box()["width"] > before
    page.click("#diagram-close")
    assert not page.locator("#diagram-view").is_visible()
    page.click("#explain-back")
    assert page.locator("#preview").is_visible()


def test_token_sheet_closes_and_tells_the_days_left(context, page_origin, repo):
    page = open_page(context, page_origin, repo, practice=False)
    page.click("#tabs [data-tab='settings']")
    page.click("#change-token")
    assert page.locator("#token-form").is_visible()
    page.click("#token-cancel")
    assert not page.locator("#token-form").is_visible()
    page.click("#change-token")
    page.fill("#token", "good-token")
    page.fill("#token-expires", "2026-12-13")
    page.click("#token-save")
    assert not page.locator("#token-form").is_visible()
    assert "30 days" in page.locator("#token-days").inner_text()
