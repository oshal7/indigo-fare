"""
Cloud Engine (runs in GitHub Actions, no browser - direct HTTP only).

Replays the request template captured by grab_token.py once per month per
route/direction across the configured scan window, using the saved session
cookies/headers. No Playwright here on purpose - this is meant to be the
lightweight, fast path; grab_token.py is the only piece that needs a real
browser.

NOTE ON THE RESPONSE PARSER: the actual JSON shape IndiGo's internal
endpoint returns is unknown until you've run grab_token.py against the real,
logged-in site and looked at a captured response body. extract_deals() below
walks the response generically, looking for dicts that contain a date-like
field and a points-like field, using the key name aliases in KEY_ALIASES.
After your first real capture, open data/debug_last_response.json (written
automatically) and adjust KEY_ALIASES to match the real field names.

Env vars:
    SESSION_PROFILE_PATH   path to session_profile.json (default: ./session_profile.json)
    CONFIG_PATH            path to config.json (default: ./config.json)
"""

from __future__ import annotations

import base64
import json
import os
import random
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", REPO_ROOT / "config.json"))
SESSION_PROFILE_PATH = Path(os.environ.get("SESSION_PROFILE_PATH", REPO_ROOT / "session_profile.json"))
DATA_PATH = REPO_ROOT / "data" / "data.json"
DOCS_DATA_PATH = REPO_ROOT / "docs" / "data.json"
DEBUG_RESPONSE_PATH = REPO_ROOT / "data" / "debug_last_response.json"

# Best-effort key name aliases for the unknown response schema - edit these
# after inspecting a real captured response (see module docstring).
KEY_ALIASES = {
    "date": {"date", "traveldate", "departuredate", "flightdate"},
    "points": {"points", "bluechips", "loyaltypoints", "pointsrequired", "chipprice", "blueChipPrice"},
    "flight_number": {"flightnumber", "flightno", "flight", "flightcode"},
    "departure_time": {"departuretime", "deptime", "departs"},
    "arrival_time": {"arrivaltime", "arrtime", "arrives"},
}


class SessionExpiredError(RuntimeError):
    pass


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_session_profile() -> dict:
    if SESSION_PROFILE_PATH.exists():
        return load_json(SESSION_PROFILE_PATH)
    raise FileNotFoundError(
        f"{SESSION_PROFILE_PATH} not found - decode the INDIGO_SESSION_PROFILE_B64 "
        "secret to this path before running (see .github/workflows/fetch-fares.yml)."
    )


def month_start_dates(window_days: int) -> list[date]:
    today = date.today()
    months = []
    cursor = today
    seen_months = set()
    days_covered = 0
    while days_covered < window_days:
        key = (cursor.year, cursor.month)
        if key not in seen_months:
            months.append(cursor)
            seen_months.add(key)
        cursor = cursor.replace(day=1)
        # advance to the 1st of the next month
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
        days_covered = (cursor - today).days
    return months


def build_request(template: dict, origin: str, destination: str, travel_date: date) -> dict:
    token_map = {"{DATE}": travel_date.isoformat(), "{ORIGIN}": origin, "{DEST}": destination}

    def fill(value: str | None) -> str | None:
        if value is None:
            return None
        for token, literal in token_map.items():
            value = value.replace(token, literal)
        return value

    return {
        "method": template["method"],
        "url": fill(template["url_template"]),
        "headers": template.get("headers", {}),
        "data": fill(template.get("post_data_template")),
    }


def looks_like_login_wall(response: requests.Response) -> bool:
    if response.status_code in (401, 403):
        return True
    snippet = response.text[:300].lower()
    return "login" in snippet or "unauthorized" in snippet or "sign in" in snippet


def matches_alias(key: str, alias_set: set[str]) -> bool:
    return key.lower().replace("_", "").replace("-", "") in alias_set


def extract_deals(payload, origin: str, destination: str) -> list[dict]:
    """Generically walk the JSON response for date+points-shaped dicts."""
    found: list[dict] = []

    def walk(node):
        if isinstance(node, dict):
            mapped = {}
            for field, aliases in KEY_ALIASES.items():
                for key, value in node.items():
                    if matches_alias(key, aliases):
                        mapped[field] = value
                        break
            if "date" in mapped and "points" in mapped:
                try:
                    points = int("".join(ch for ch in str(mapped["points"]) if ch.isdigit()))
                except ValueError:
                    points = None
                if points is not None:
                    found.append(
                        {
                            "origin": origin,
                            "destination": destination,
                            "date": str(mapped["date"])[:10],
                            "flight_number": str(mapped.get("flight_number", "")),
                            "departure_time": str(mapped.get("departure_time", "")),
                            "arrival_time": str(mapped.get("arrival_time", "")),
                            "points": points,
                        }
                    )
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found


def fetch_month(session: requests.Session, template: dict, origin: str, destination: str, month_date: date) -> list[dict]:
    req = build_request(template, origin, destination, month_date)
    response = session.request(
        req["method"], req["url"], headers=req["headers"], data=req["data"], timeout=30
    )
    if looks_like_login_wall(response):
        raise SessionExpiredError(
            f"Hit a login wall calling {req['url']} - re-run scripts/grab_token.py and refresh the secret."
        )
    response.raise_for_status()

    DEBUG_RESPONSE_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        payload = response.json()
        DEBUG_RESPONSE_PATH.write_text(json.dumps(payload, indent=2)[:50000])
    except ValueError:
        DEBUG_RESPONSE_PATH.write_text(response.text[:50000])
        return []

    return extract_deals(payload, origin, destination)


def main() -> None:
    config = load_json(CONFIG_PATH)
    profile = load_session_profile()
    template = profile["request_template"]

    session = requests.Session()
    for cookie in profile.get("cookies", []):
        session.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain"))

    months = month_start_dates(config["scan_window_days"])
    all_deals: list[dict] = []

    for route in config["routes"]:
        for origin, destination in [
            (route["origin"], route["destination"]),
            (route["destination"], route["origin"]),
        ]:
            for month_date in months:
                try:
                    all_deals.extend(fetch_month(session, template, origin, destination, month_date))
                except SessionExpiredError as e:
                    print(f"::error::{e}")
                    sys.exit(1)
                except Exception as e:
                    print(f"::warning::Failed {origin}-{destination} {month_date}: {e}")
                time.sleep(random.uniform(1.0, 3.5))

    today = date.today()
    max_points = config.get("max_points_baseline")
    deduped: dict[str, dict] = {}
    for deal in all_deals:
        try:
            deal_date = date.fromisoformat(deal["date"])
        except ValueError:
            continue
        if deal_date < today:
            continue
        if max_points is not None and deal["points"] > max_points:
            continue
        key = f"{deal['date']}|{deal['origin']}-{deal['destination']}|{deal['flight_number']}"
        deal["booking_url"] = config["booking_url_template"].format(**deal)
        deduped[key] = deal

    deals = sorted(deduped.values(), key=lambda d: d["points"])

    output = {
        "last_updated_timestamp": datetime.now(timezone.utc).isoformat(),
        "routes": config["routes"],
        "deals": deals,
    }
    DATA_PATH.write_text(json.dumps(output, indent=2))
    DOCS_DATA_PATH.write_text(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
