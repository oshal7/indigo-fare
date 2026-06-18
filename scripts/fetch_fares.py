"""
Scheduled scraper: checks IndiGo BluChip redemption prices for BLR<->NAG
flights across a rolling 6-month window, a batch of dates at a time, and
upserts results into data/fares.json.

NOTE: The selectors below are best-effort placeholders. goindigo.in's
search/results DOM was not available to verify against a live, authenticated
session while writing this script. Before trusting the scheduled GitHub
Action, run this once locally with HEADLESS=0 against your real account,
watch it navigate, and fix selectors (look for them after `# SELECTOR:`)
against what you actually see in the browser/devtools.

Usage:
    python scripts/fetch_fares.py
Env vars:
    STORAGE_STATE_PATH   path to the exported session file (default: storage_state.json)
    BATCH_SIZE           how many (date, route) cells to check this run (default: 25)
    WINDOW_DAYS          size of the rolling window in days (default: 182)
    HEADLESS             "0" to run with a visible browser for debugging (default: "1")
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
FARES_PATH = REPO_ROOT / "data" / "fares.json"
DOCS_FARES_PATH = REPO_ROOT / "docs" / "data" / "fares.json"
CURSOR_PATH = REPO_ROOT / "data" / "scan_cursor.json"

ROUTES = [("BLR", "NAG"), ("NAG", "BLR")]
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "182"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "25"))
STORAGE_STATE_PATH = os.environ.get("STORAGE_STATE_PATH", "storage_state.json")
HEADLESS = os.environ.get("HEADLESS", "1") != "0"

SEARCH_URL = "https://www.goindigo.in/"


class SessionExpiredError(RuntimeError):
    pass


def build_all_cells() -> list[tuple[date, tuple[str, str]]]:
    today = date.today()
    return [
        (today + timedelta(days=d), route)
        for d in range(WINDOW_DAYS)
        for route in ROUTES
    ]


def load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def detect_login_wall(page: Page) -> bool:
    """Heuristics for 'this isn't the search results, it's a login wall'."""
    if "login" in page.url.lower():
        return True
    if page.locator("input[type='password']").count() > 0:
        return True
    if page.locator("text=/OTP|one[- ]?time password/i").count() > 0:
        return True
    return False


def scrape_one(page: Page, origin: str, dest: str, flight_date: date) -> list[dict]:
    """Search one route/date with BluChip redemption on, scrape flight rows.

    Best-effort flow - selectors are placeholders, verify live. See module
    docstring.
    """
    page.goto(SEARCH_URL, wait_until="domcontentloaded")
    if detect_login_wall(page):
        raise SessionExpiredError(f"Hit a login wall navigating to {SEARCH_URL}")

    # SELECTOR: origin input - placeholder, confirm against real DOM
    page.click("[data-testid='origin-input']")
    page.fill("[data-testid='origin-input']", origin)
    page.click(f"text='{origin}'")

    # SELECTOR: destination input - placeholder
    page.click("[data-testid='destination-input']")
    page.fill("[data-testid='destination-input']", dest)
    page.click(f"text='{dest}'")

    # SELECTOR: date picker - placeholder
    page.click("[data-testid='travel-date']")
    page.click(f"[data-date='{flight_date.isoformat()}']")

    # SELECTOR: "Redeem BluChips" toggle - placeholder
    bluechip_toggle = page.locator("[data-testid='redeem-bluechips-toggle']")
    if bluechip_toggle.count() > 0 and not bluechip_toggle.is_checked():
        bluechip_toggle.click()

    # SELECTOR: search submit button - placeholder
    page.click("[data-testid='search-flights-button']")
    page.wait_for_load_state("networkidle")

    if detect_login_wall(page):
        raise SessionExpiredError(f"Hit a login wall after searching {origin}-{dest} {flight_date}")

    # SELECTOR: flight result rows - placeholder
    rows = page.locator("[data-testid='flight-result-row']")
    results = []
    for i in range(rows.count()):
        row = rows.nth(i)
        flight_number = row.locator("[data-testid='flight-number']").inner_text().strip()
        departure_time = row.locator("[data-testid='departure-time']").inner_text().strip()
        arrival_time = row.locator("[data-testid='arrival-time']").inner_text().strip()
        bluechip_text = row.locator("[data-testid='bluechip-price']").inner_text().strip()
        bluechip_price = int("".join(ch for ch in bluechip_text if ch.isdigit()))

        results.append(
            {
                "date": flight_date.isoformat(),
                "origin": origin,
                "destination": dest,
                "flight_number": flight_number,
                "departure_time": departure_time,
                "arrival_time": arrival_time,
                "bluechip_price": bluechip_price,
            }
        )
    return results


def upsert(fares: dict, entries: list[dict], checked_at: str) -> None:
    for entry in entries:
        key = f"{entry['date']}|{entry['origin']}-{entry['destination']}|{entry['flight_number']}"
        fares[key] = {**entry, "last_checked_at": checked_at}


def prune_past_dates(fares: dict, today: date) -> dict:
    return {k: v for k, v in fares.items() if date.fromisoformat(v["date"]) >= today}


def main() -> None:
    cells = build_all_cells()
    cursor = load_json(CURSOR_PATH, {"offset": 0})
    offset = cursor.get("offset", 0) % len(cells)
    batch = [cells[(offset + i) % len(cells)] for i in range(BATCH_SIZE)]

    fares_doc = load_json(FARES_PATH, {"last_updated": None, "fares": {}})
    fares = fares_doc.get("fares", {})
    checked_at = datetime.now(timezone.utc).isoformat()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        context = browser.new_context(storage_state=STORAGE_STATE_PATH)
        page = context.new_page()

        for flight_date, (origin, dest) in batch:
            try:
                results = scrape_one(page, origin, dest, flight_date)
                upsert(fares, results, checked_at)
            except SessionExpiredError as e:
                print(f"::error::Session expired - re-run scripts/export_session.py and update the secret. ({e})")
                browser.close()
                sys.exit(1)
            except Exception as e:
                Path("debug").mkdir(exist_ok=True)
                page.screenshot(path=f"debug/{origin}-{dest}_{flight_date}.png")
                print(f"::warning::Failed {origin}-{dest} {flight_date}: {e}")
                continue

        browser.close()

    fares = prune_past_dates(fares, date.today())
    fares_doc = {"last_updated": checked_at, "fares": fares}

    save_json(FARES_PATH, fares_doc)
    save_json(DOCS_FARES_PATH, fares_doc)
    save_json(CURSOR_PATH, {"offset": (offset + BATCH_SIZE) % len(cells)})


if __name__ == "__main__":
    main()
