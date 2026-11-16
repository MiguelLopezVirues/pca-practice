"""Practice page: behaviour contract, written before the page.

The page contract these tests rely on:
- URL parameters `api` (API base; honoured only when the page itself is served from localhost or 127.0.0.1)
  and `repo` (owner/name). Without `api` the page talks to https://api.github.com.
- No token stored: `#token-form` with `#token` and `#token-save`; no API request before a token exists.
- `#status[data-state]`: loading | ready | done | no-token | token-expired | error (the page).
- `#sync[data-state]`: idle | saving | offline | token-expired | error (saving to GitHub); tapping `#sync` saves now.
- `#pending[data-count]`: answers kept on the phone and not yet saved to GitHub.
- Rating shows the next card at once; answers are saved in the background, several per commit: when 5 are
  waiting, when nothing is left to answer, when the page is hidden, after 30 s without answers, or on `#sync`.
  When nothing else changed on GitHub since the page's own last save, a save downloads nothing.
- On opening, the page shows the cards from the copy kept on the phone, then checks GitHub.
- A card: `#card-front` (one of the card's `fronts`, in turn: the n-th review shows phrasing n, cycling; a card
  with a single `front` shows it), `#reveal`, `#card-back` (shown after reveal), then two steps: `#know-no` / `#know-yes`
  ("Did you know it?"), and after yes `#came-instantly` / `#came-moment` / `#came-effort` ("How did it come?"),
  giving Again / Easy / Good / Hard. `#rules` explains the two steps.
- Each save: one commit on main touching only files under pilot/practice/state/, including
  answers.jsonl (one JSON line per answer: id, item, rating, time, prompt) and the engine's own state files;
  the engine logs the phrasing shown as the prompt id `card:<n>`.
"""
from __future__ import annotations

import json
import time
from datetime import timedelta

from conftest import (FIRST_TOPIC, STATE, STATE_FILES, T0, desktop_apply, desktop_queue, items_by_id, open_page,
                      page_url, rate, save_now, seed_files, settle)
from fake_github import FakeRepo, serve


def flashcard_queue(files, now, tmp):
    items = items_by_id(files)
    return [i for i in desktop_queue(files, now, tmp) if items[i]["channel"] == "flashcard"]


def answers(repo):
    data = repo.files().get(STATE + "answers.jsonl", b"")
    return [json.loads(line) for line in data.decode().splitlines() if line.strip()]


def fronts_of(item):
    return item["card"].get("fronts") or [item["card"]["front"]]


def front_of(files, item_id):
    return fronts_of(items_by_id(files)[item_id])[0]


def serve_files(files):
    r = FakeRepo()
    r.seed(files)
    server = serve(r)
    r.api = f"http://127.0.0.1:{server.server_address[1]}"
    return r, server


def set_cards(files, change):
    """Apply change(card dict, item id) to every flashcard in the item files."""
    for path in [p for p in files if p.startswith("pilot/practice/items/")]:
        items = json.loads(files[path])
        for it in items:
            if it["channel"] == "flashcard":
                change(it["card"], it["id"])
        files[path] = json.dumps(items).encode()


def same_state(actual: dict, expected: dict):
    """Engine files equal; in state.json the FSRS card ids are ignored (py-fsrs stamps them with the wall clock)."""
    for path, data in expected.items():
        if path.endswith("state.json"):
            a, e = json.loads(actual[path]), json.loads(data)
            for s in (a, e):
                for card in s["cards"].values():
                    card.pop("card_id", None)
            assert a == e, path
        else:
            assert actual[path] == data, path


# ---------- opening ----------
def test_first_open_asks_for_token_and_calls_nothing(context, page_origin, repo):
    page = context.new_page()
    page.goto(page_url(page_origin, repo))
    page.wait_for_selector("#token-form", state="visible")
    assert repo.requests == []


def test_shows_first_flashcard_of_the_engine_queue(context, page_origin, repo, tmp_path):
    seed = repo.files()
    page = open_page(context, page_origin, repo)
    first = flashcard_queue(seed, T0, tmp_path)[0]
    assert page.locator("#status").get_attribute("data-state") == "ready"
    assert page.locator("#card-front").inner_text().strip() == front_of(seed, first).strip()
    assert not page.locator("#card-back").is_visible()


# ---------- saving ----------
def test_rating_saves_one_commit_that_matches_the_desktop_engine(context, page_origin, repo, tmp_path):
    seed = repo.files()
    first = flashcard_queue(seed, T0, tmp_path)[0]
    page = open_page(context, page_origin, repo)
    n = len(repo.commits())
    rate(page, 3)
    save_now(page)
    commits = repo.commits()
    assert len(commits) == n + 1
    changed = repo.changed_paths(commits[-1]["sha"])
    assert changed <= STATE_FILES
    assert {STATE + "answers.jsonl", STATE + "state.json", STATE + "reviews.tsv"} <= changed
    expected = desktop_apply(seed, [("record", first, 3, T0)], tmp_path)
    same_state(repo.files(), expected)


def test_each_answer_is_logged_once_with_an_id(context, page_origin, repo, tmp_path):
    first = flashcard_queue(repo.files(), T0, tmp_path)[0]
    page = open_page(context, page_origin, repo)
    rate(page, 3)
    save_now(page)
    log = answers(repo)
    assert len(log) == 1
    assert log[0]["item"] == first and log[0]["rating"] == 3 and log[0]["id"] and log[0]["time"]
    assert page.locator("#pending").get_attribute("data-count") == "0"


def test_two_steps_give_again_hard_good_easy(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    page.click("#reveal")
    assert page.locator("#rules").is_visible()
    assert not page.locator("#came-instantly").is_visible()
    page.click("#know-yes")
    assert page.locator("#came-instantly").is_visible()
    page.click("#came-effort")
    settle(page)
    for rating in (1, 3, 4):
        rate(page, rating)
    save_now(page)
    assert [a["rating"] for a in answers(repo)] == [2, 1, 3, 4]


def test_only_flashcards_are_shown(context, page_origin, repo):
    items = items_by_id(repo.files())
    fronts = {f.strip() for it in items.values() if it["channel"] == "flashcard" for f in fronts_of(it)}
    page = open_page(context, page_origin, repo)
    for _ in range(4):
        if page.locator("#status").get_attribute("data-state") == "done":
            break
        assert page.locator("#card-front").inner_text().strip() in fronts
        rate(page, 3)


# ---------- speed ----------
def test_next_card_shows_without_waiting_for_github(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    n = len(repo.commits())
    first = page.locator("#card-front").inner_text()
    start = time.monotonic()
    rate(page, 3)
    page.wait_for_function(f"() => document.querySelector('#card-front').innerText !== {json.dumps(first)}")
    assert time.monotonic() - start < 2
    assert len(repo.commits()) == n
    assert page.locator("#pending").get_attribute("data-count") == "1"


def test_answers_are_saved_together(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    n = len(repo.commits())
    for _ in range(3):
        rate(page, 3)
    assert save_now(page) == "idle"
    assert len(repo.commits()) == n + 1
    assert len(answers(repo)) == 3


def test_answers_are_saved_by_themselves(context, page_origin, repo):
    """The first topic has 5 flashcards: after the fifth answer (and nothing left) the page saves without a tap."""
    page = open_page(context, page_origin, repo)
    while page.locator("#status").get_attribute("data-state") != "done":
        rate(page, 3)
    page.wait_for_function("() => document.querySelector('#pending').dataset.count === '0'", timeout=60_000)
    assert len(answers(repo)) == 5


def test_saving_again_downloads_nothing_when_nothing_changed(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    rate(page, 3)
    save_now(page)
    reads = repo.count("GET", r"/git/(trees|blobs|commits)/")
    rate(page, 3)
    save_now(page)
    assert repo.count("GET", r"/git/(trees|blobs|commits)/") == reads
    assert len(answers(repo)) == 2


def test_opens_from_the_phone_copy_before_github_answers(context, page_origin, repo):
    open_page(context, page_origin, repo).close()
    repo.ref_delay = 20
    start = time.monotonic()
    page = context.new_page()
    page.goto(page_url(page_origin, repo))
    page.wait_for_function("() => document.querySelector('#card-front')?.innerText.trim()", timeout=60_000)
    assert time.monotonic() - start < 15
    repo.ref_delay = 0


# ---------- phrasings ----------
def test_phrasings_turn_with_each_review_and_are_logged(context, page_origin, tmp_path):
    """Every flashcard reviewed once before (Again, so due again): the page shows the second phrasing and logs card:2."""
    def three(card, iid):
        card.pop("front", None)
        card["fronts"] = [f"A {iid}", f"B {iid}", f"C {iid}"]

    files = seed_files(tmp_path)
    set_cards(files, three)
    cards = [i for i, it in items_by_id(files).items() if it["channel"] == "flashcard"]
    files.update(desktop_apply(files, [("record", i, 1, T0 - timedelta(days=1), "card:1") for i in cards], tmp_path))
    r, server = serve_files(files)
    try:
        page = open_page(context, page_origin, r)
        shown = page.locator("#card-front").inner_text().strip()
        assert shown.startswith("B ")
        rate(page, 3)
        save_now(page)
        last = r.files()[STATE + "reviews.tsv"].decode().strip().splitlines()[-1].split("\t")
        assert last[2] == shown[2:] and last[4] == "card:2"
        assert answers(r)[-1]["prompt"] == "card:2"
    finally:
        server.shutdown()


def test_card_with_a_single_front_still_works(context, page_origin, tmp_path):
    def one(card, iid):
        card["front"] = card.pop("fronts", [card.get("front")])[0]

    files = seed_files(tmp_path, lambda f: set_cards(f, one))
    first = flashcard_queue(files, T0, tmp_path)[0]
    r, server = serve_files(files)
    try:
        page = open_page(context, page_origin, r)
        assert page.locator("#card-front").inner_text().strip() == front_of(files, first).strip()
        rate(page, 3)
        save_now(page)
        assert answers(r)[-1]["prompt"] == "card:1"
    finally:
        server.shutdown()


# ---------- conflicts, network, token ----------
def test_rejected_commit_reloads_and_applies_the_answer_again(context, page_origin, repo, tmp_path):
    seed = repo.files()
    queue = flashcard_queue(seed, T0, tmp_path)
    phone_item = queue[0]
    other = next(i for i in desktop_queue(seed, T0, tmp_path) if i != phone_item)
    desktop_state = desktop_apply(seed, [("record", other, 3, T0)], tmp_path)
    page = open_page(context, page_origin, repo)
    repo.before_next_ref_update = lambda: repo.push_external(desktop_state, "desktop session")
    rate(page, 3)
    save_now(page)
    messages = [c["message"] for c in repo.commits()]
    assert messages[-2] == "desktop session"
    assert len(answers(repo)) == 1
    expected = desktop_apply(seed, [("record", other, 3, T0), ("record", phone_item, 3, T0)], tmp_path)
    same_state(repo.files(), expected)


def test_offline_answer_is_kept_and_sent_at_next_open(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    n = len(repo.commits())
    repo.offline = True
    rate(page, 3)
    assert save_now(page) == "offline"
    assert page.locator("#pending").get_attribute("data-count") == "1"
    assert len(repo.commits()) == n
    page.close()
    repo.offline = False
    page = open_page(context, page_origin, repo)
    page.wait_for_function("() => document.querySelector('#pending').dataset.count === '0'", timeout=60_000)
    assert len(repo.commits()) == n + 1
    assert len(answers(repo)) == 1


def test_expired_token_keeps_the_answer_until_a_new_token(context, page_origin, repo):
    page = open_page(context, page_origin, repo)
    repo.token = "new-token"
    rate(page, 3)
    assert save_now(page) == "token-expired"
    assert page.locator("#pending").get_attribute("data-count") == "1"
    assert page.locator("#token-form").is_visible()
    page.fill("#token", "new-token")
    page.click("#token-save")
    page.wait_for_function("() => document.querySelector('#pending').dataset.count === '0'", timeout=60_000)
    assert len(answers(repo)) == 1


def test_saved_answer_is_not_applied_twice_when_the_reply_is_lost(context, page_origin, repo):
    page = open_page(context, page_origin, repo)

    def lose_reply(route):
        route.fetch()
        route.abort()

    page.route("**/git/refs/heads/main", lose_reply)
    rate(page, 3)
    save_now(page)
    assert len(answers(repo)) == 1
    page.close()
    open_page(context, page_origin, repo)
    assert len(answers(repo)) == 1


def test_unchanged_files_are_not_downloaded_again(context, page_origin, repo):
    open_page(context, page_origin, repo).close()
    before = repo.count("GET", r"/git/blobs/")
    open_page(context, page_origin, repo)
    assert repo.count("GET", r"/git/blobs/") == before


# ---------- safety ----------
def test_card_text_is_shown_as_text_not_html(context, page_origin, tmp_path):
    evil = '<img src=x onerror="window.__xss=1">'
    files = seed_files(tmp_path)
    first = flashcard_queue(files, T0, tmp_path)[0]
    path = f"pilot/practice/items/{first.split('.')[0]}.json"
    items = json.loads(files[path])
    card = next(it for it in items if it["id"] == first)["card"]
    card["front"], card["fronts"] = evil, [evil]
    files[path] = json.dumps(items).encode()
    r = FakeRepo()
    r.seed(files)
    server = serve(r)
    r.api = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        page = open_page(context, page_origin, r)
        assert page.locator("#card-front").inner_text().strip() == evil
        assert page.evaluate("() => window.__xss") is None
    finally:
        server.shutdown()


def test_token_is_sent_only_to_the_api(context, page_origin, repo):
    with_auth = []
    context.on("request", lambda req: with_auth.append(req.url) if "authorization" in req.headers else None)
    page = open_page(context, page_origin, repo)
    rate(page, 3)
    save_now(page)
    assert with_auth and all(u.startswith(repo.api + "/") for u in with_auth)


def test_api_parameter_is_ignored_off_localhost(browser, page_origin, repo):
    port = page_origin.rsplit(":", 1)[1]
    ctx = browser.new_context(service_workers="block")
    try:
        hits = []
        ctx.route("https://api.github.com/**", lambda route: (hits.append(route.request.url),
                                                               route.fulfill(status=401, body="{}")))
        page = ctx.new_page()
        page.goto(f"http://practice.test:{port}/index.html?api={repo.api}&repo=me/pca-study")
        page.wait_for_selector("#token-form", state="visible")
        page.fill("#token", "good-token")
        page.click("#token-save")
        page.wait_for_function("() => document.querySelector('#status')?.dataset.state === 'token-expired'",
                               timeout=60_000)
        assert hits
        assert repo.requests == []
    finally:
        ctx.close()
