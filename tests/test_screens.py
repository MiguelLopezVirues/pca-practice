"""Practice page screens (design D): Today, practice, Cards, Progress, Settings.

The screen contract these tests rely on:
- Tabs `#tabs button[data-tab]` (today | cards | progress | settings) show `#view-<tab>`; the page opens on Today.
- Today: `#count-due` (flashcards due again), `#count-new` (new flashcards open now), `#count-ai` (questions for an
  AI session), `#start` (shows `#view-practice`; `#practice-close` goes back), `#next-topic` (the first topic of
  pilot/practice/topics.json not read yet) opening `#topic-sheet` with `#read-link` (obsidian://open?vault=vault&file=
  the note path without .md) and `#mark-read`, which marks the topic read in the engine and saves it like an answer
  (answers.jsonl gets a line {"id", "type": "read", "topic", "time"}).
- Practice: the key points `#card-points li` can be ticked (aria-checked); ticked indexes go with the answer as
  "ticked".
- Cards: `#cards-list .card-row[data-item][data-status][data-topic]` for every question; status is due | new |
  learn | later | ai | locked. `#cards-search` filters by text; `#cards-filters [data-filter]` by status;
  `#filter-sheet input[data-topic]` by topic. A row opens `#preview` showing the card as in review
  (`#preview-front`, `#preview-reveal`, `#preview-back`, `#preview-points li`); nothing is recorded.
- Progress: `.topic-progress[data-topic][data-total][data-known][data-learning]`, in topics.json order.
- Settings: `[data-theme-choice]` system | light | dark sets html[data-theme]; kept across visits.
"""
from __future__ import annotations

import json
from urllib.parse import quote

from conftest import (FIRST_TOPIC, STATE, T0, click_row, desktop_apply, desktop_queue, items_by_id, open_page, plain,
                      rate, save_now, topics_with_concern)
from test_page import answers, front_of, same_state


def topics(files):
    return topics_with_concern(files)


def today(context, page_origin, repo):
    page = open_page(context, page_origin, repo, practice=False)
    page.wait_for_selector("#view-today", state="visible")
    return page


def rows(page, status=None):
    sel = "#cards-list .card-row" + (f"[data-status='{status}']" if status else "")
    return page.locator(sel)


def visible_rows(page):
    return [r for r in page.locator("#cards-list .card-row").all() if r.is_visible()]


# ---------- Today ----------
def test_opens_on_today_with_the_counts_of_the_engine(context, page_origin, repo, tmp_path):
    seed = repo.files()
    items = items_by_id(seed)
    reviewed = set(json.loads(seed[STATE + "state.json"])["cards"])
    queue = desktop_queue(seed, T0, tmp_path)
    flash = [i for i in queue if items[i]["channel"] == "flashcard"]
    page = today(context, page_origin, repo)
    assert page.locator("#count-due").inner_text().strip() == str(len([i for i in flash if i in reviewed]))
    assert page.locator("#count-new").inner_text().strip() == str(len([i for i in flash if i not in reviewed]))
    assert page.locator("#count-ai").inner_text().strip() == str(len(queue) - len(flash))
    assert not page.locator("#view-cards").is_visible()


def test_start_opens_practice_and_close_goes_back(context, page_origin, repo, tmp_path):
    seed = repo.files()
    page = today(context, page_origin, repo)
    page.click("#start")
    first = [i for i in desktop_queue(seed, T0, tmp_path) if items_by_id(seed)[i]["channel"] == "flashcard"][0]
    assert plain(page.locator("#card-front").inner_text()) == plain(front_of(seed, first))
    assert not page.locator("#tabs").is_visible()
    page.click("#practice-close")
    assert page.locator("#view-today").is_visible()


def test_next_topic_links_its_note_and_can_be_marked_read(context, page_origin, repo, tmp_path):
    seed = repo.files()
    nxt, after = [t for t in topics(seed) if t["topic"] != FIRST_TOPIC][:2]
    page = today(context, page_origin, repo)
    new_before = int(page.locator("#count-new").inner_text())
    assert nxt["title"] in page.locator("#next-topic").inner_text()
    page.click("#next-topic")
    href = page.locator("#read-link").get_attribute("href")
    assert href == "obsidian://open?vault=vault&file=" + quote(nxt["note"][:-3], safe="")
    page.click("#mark-read")
    page.wait_for_function(f"() => Number(document.querySelector('#count-new').innerText) > {new_before}")
    assert after["title"] in page.locator("#next-topic").inner_text()
    save_now(page)
    expected = desktop_apply(seed, [("read", nxt["topic"], T0)], tmp_path)
    same_state(repo.files(), {p: d for p, d in expected.items() if not p.endswith("answers.jsonl")})
    log = answers(repo)
    assert [(a["type"], a["topic"]) for a in log] == [("read", nxt["topic"])]


# ---------- practice ----------
def test_ticked_key_points_go_with_the_answer(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    page.click("#reveal")
    point = page.locator("#card-points li").first
    point.click()
    assert point.get_attribute("aria-checked") == "true"
    page.click("#know-yes")
    page.click("#came-moment")
    save_now(page)
    assert answers(repo)[0]["ticked"] == [0]


# ---------- Cards ----------
def test_cards_lists_every_question_with_its_status(context, page_origin, repo, tmp_path):
    seed = repo.files()
    items = items_by_id(seed)
    queue = desktop_queue(seed, T0, tmp_path)
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='cards']")
    assert rows(page).count() == len(items)
    flash = [i for i in queue if items[i]["channel"] == "flashcard"]
    assert rows(page).nth(0).get_attribute("data-item") is not None
    assert page.locator(f".card-row[data-item='{flash[0]}']").get_attribute("data-status") == "new"
    ai = [i for i in queue if items[i]["channel"] != "flashcard"][0]
    assert page.locator(f".card-row[data-item='{ai}']").get_attribute("data-status") == "ai"
    locked = next(i for i in items if i.startswith(topics(seed)[1]["topic"] + "."))
    assert page.locator(f".card-row[data-item='{locked}']").get_attribute("data-status") == "locked"


def test_cards_search_status_and_topic_filters(context, page_origin, repo):
    seed = repo.files()
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='cards']")
    page.fill("#cards-search", "client")
    shown = visible_rows(page)
    assert shown and len(shown) < rows(page).count()
    assert all("client" in r.inner_text().lower() for r in shown)
    page.fill("#cards-search", "")
    page.click("#cards-filters [data-filter='ai']")
    shown = visible_rows(page)
    assert shown and all(r.get_attribute("data-status") == "ai" for r in shown)
    page.click("#cards-filters [data-filter='all']")
    page.click("#open-filters")
    topic = topics(seed)[1]["topic"]
    for box in page.locator("#filter-sheet input[data-topic]").all():
        if box.get_attribute("data-topic") != topic:
            box.uncheck()
    page.click("#filter-done")
    shown = visible_rows(page)
    assert shown and all(r.get_attribute("data-topic") == topic for r in shown)


def test_preview_shows_the_card_as_in_review_and_records_nothing(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    flash = next(i for i, it in items.items() if it["channel"] == "flashcard")
    page = today(context, page_origin, repo)
    n = len(repo.commits())
    page.click("#tabs [data-tab='cards']")
    click_row(page, flash)
    assert page.locator("#preview").is_visible()
    assert plain(page.locator("#preview-front").inner_text()) == plain(front_of(seed, flash))
    assert not page.locator("#preview-back").is_visible()
    page.click("#preview-reveal")
    assert plain(page.locator("#preview-back").inner_text()) == plain(items[flash]["card"]["back"])
    assert page.locator("#preview-points li").count() == len(items[flash].get("must", []))
    page.click("#preview-close")
    assert page.locator("#pending").get_attribute("data-count") == "0"
    save_now(page)
    assert len(repo.commits()) == n


# ---------- Progress ----------
def test_progress_shows_each_topic_in_reading_order(context, page_origin, repo):
    seed = repo.files()
    items = items_by_id(seed)
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='progress']")
    bars = page.locator(".topic-progress")
    assert [b.get_attribute("data-topic") for b in bars.all()] == [t["topic"] for t in topics(seed)]
    first = bars.nth(0)
    def topic_of(it):  # the engine's rule
        return it["unit"] if it.get("facet") == "T" else it["unit"].rsplit(".", 1)[0]
    def turn_of(it):  # the page's rule: lean turn, or networking depth 2 = turn 2
        return it.get("turn") or (2 if it.get("depth", 1) >= 2 else 1)
    assert int(first.get_attribute("data-total")) == sum(1 for it in items.values()
                                                         if topic_of(it) == topics(seed)[0]["topic"] and turn_of(it) == 1)
    assert first.get_attribute("data-known") == "0"


def test_progress_is_grouped_by_concern_with_counts(context, page_origin, repo):
    seed = repo.files()
    order = list(dict.fromkeys(t["concern"] for t in topics(seed)))
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='progress']")
    groups = page.locator("#topics .progress-concern")
    assert [g.get_attribute("data-concern") for g in groups.all()] == order
    first = groups.first
    total = sum(int(b.get_attribute("data-total")) for b in first.locator(".topic-progress").all())
    assert first.locator(":scope > summary .pill[data-count='known'] b").inner_text().strip() == f"0/{total}"
    assert page.locator("#progress-turns button.on").get_attribute("data-turn") == "1"


def test_turn_buttons_put_the_count_under_the_label(context, page_origin, repo):
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='cards']")
    button = page.locator("#cards-turns button[data-turn='all']")
    label, count = button.locator("span").bounding_box(), button.locator("b").bounding_box()
    assert count["y"] >= label["y"] + label["height"] - 1


# ---------- Settings ----------
def test_theme_choice_is_kept(context, page_origin, repo):
    page = today(context, page_origin, repo)
    page.click("#tabs [data-tab='settings']")
    page.click("[data-theme-choice='dark']")
    assert page.locator("html").get_attribute("data-theme") == "dark"
    page.reload()
    page.wait_for_selector("#view-today", state="visible")
    assert page.locator("html").get_attribute("data-theme") == "dark"
