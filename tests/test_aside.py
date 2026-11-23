"""Setting a question aside ("Not now") and bringing it back.

Contract:
- The practice card has `#not-now`: the question is set aside (engine `mute`, saved like an answer as
  `{"type": "aside", "item", "aside": true}`) and the next card shows.
- Cards lists it with status `aside` (chip `[data-filter='aside']`); its preview has `#preview-aside`, which reads
  "Bring back" for a question set aside and brings it back (`"aside": false`).
"""
from __future__ import annotations

import json

from conftest import STATE, click_row, next_card, open_page, save_now
from test_page import answers


def test_not_now_sets_the_question_aside_and_shows_the_next(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    before = page.locator("#card-front").inner_text()
    page.click("#not-now")
    next_card(page, before)
    save_now(page)
    last = answers(repo)[-1]
    assert (last["type"], last["aside"]) == ("aside", True)
    state = json.loads(repo.files()[STATE + "state.json"])
    assert state["items"][last["item"]]["muted"]


def test_a_question_set_aside_shows_in_cards_and_comes_back(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    before = page.locator("#card-front").inner_text()
    page.click("#not-now")
    next_card(page, before)
    page.click("#practice-close")
    page.click("#tabs [data-tab='cards']")
    page.click("#cards-filters [data-filter='aside']")
    row = page.locator(".card-row[data-status='aside']")
    assert row.count() == 1
    item = row.first.get_attribute("data-item")
    click_row(page, item)
    assert page.locator("#preview-aside").inner_text().strip() == "Bring back"
    page.click("#preview-aside")
    page.wait_for_selector(f".card-row[data-item='{item}'][data-status='aside']", state="detached")
    assert page.locator("#preview-aside").inner_text().strip() == "Not now: set aside"
    page.click("#preview-close")
    save_now(page)
    assert [(a["item"], a["aside"]) for a in answers(repo) if a.get("type") == "aside"] == [(item, True), (item, False)]
    assert not json.loads(repo.files()[STATE + "state.json"])["items"][item]["muted"]
