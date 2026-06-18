"""
Local Token Grabber (run on your own machine, never in CI).

1. Opens a real, visible Chromium window so you can log into the airline
   site yourself (handling OTP) and run ONE manual BluChip-enabled fare
   search. While you do that, this script records every network
   request/response the page makes.
2. After you confirm the search is done, it shows you the JSON-returning
   requests it captured so you can pick out the one that actually returned
   the flight/points data, and helps you turn it into a reusable template
   (substituting the date/origin/destination you used with {DATE}/
   {ORIGIN}/{DEST} placeholders).
3. Saves that template + your session cookies to session_profile.json
   (gitignored - never committed) and, if you have a GitHub token handy,
   pushes it straight to your repo's Actions secret via the GitHub API
   (no manual copy/paste of base64 blobs).

Run locally:
    pip install -r requirements.txt
    playwright install chromium
    python scripts/grab_token.py

Re-run this whenever the scheduled cloud job reports the session expired.
"""

from __future__ import annotations

import base64
import getpass
import json
import re
import subprocess
import sys
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
SESSION_PROFILE_PATH = REPO_ROOT / "session_profile.json"
SECRET_NAME = "INDIGO_SESSION_PROFILE_B64"
START_URL = "https://www.goindigo.in/"

# Headers that change per-request or are added automatically by the browser/
# fetch layer - replaying these verbatim from a captured request usually
# breaks things, so we drop them from the saved template.
VOLATILE_HEADERS = {
    "content-length",
    "host",
    ":authority",
    ":method",
    ":path",
    ":scheme",
}

JSON_KEYWORDS = ("point", "chip", "fare", "price", "amount", "flight", "segment")


def looks_like_fare_response(content_type: str, body_snippet: str) -> bool:
    if "json" not in content_type.lower():
        return False
    lowered = body_snippet.lower()
    return any(k in lowered for k in JSON_KEYWORDS)


def capture_candidates() -> list[dict]:
    candidates: list[dict] = []

    def on_response(response):
        try:
            content_type = response.headers.get("content-type", "")
            if "json" not in content_type.lower():
                return
            body = response.text()
        except Exception:
            return
        if not looks_like_fare_response(content_type, body[:2000]):
            return
        request = response.request
        candidates.append(
            {
                "url": request.url,
                "method": request.method,
                "headers": dict(request.headers),
                "post_data": request.post_data,
                "status": response.status,
                "body_snippet": body[:500],
            }
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.on("response", on_response)
        page.goto(START_URL)

        input(
            "\nA browser window has opened.\n"
            "1. Log into your IndiGo account (complete OTP if asked).\n"
            "2. Search ONE BLR<->NAG flight with 'Redeem BluChips' turned on,\n"
            "   so the points price is actually shown on screen.\n"
            "3. Come back here and press Enter once you can see the price...\n"
        )

        cookies = context.storage_state()["cookies"]
        browser.close()

    return candidates, cookies


def pick_candidate(candidates: list[dict]) -> dict:
    if not candidates:
        print("No JSON responses matching fare/points keywords were captured.")
        print("The site may render everything server-side, or use different ")
        print("wording. You'll need to inspect the browser's Network tab ")
        print("manually and adapt this script's JSON_KEYWORDS / logic.")
        sys.exit(1)

    print("\nCaptured candidate requests that look like fare/points data:\n")
    for i, c in enumerate(candidates):
        print(f"[{i}] {c['method']} {c['url']}")
        print(f"    body: {c['body_snippet'][:200]!r}\n")

    while True:
        choice = input("Enter the number of the request that has the BluChip price: ").strip()
        if choice.isdigit() and 0 <= int(choice) < len(candidates):
            return candidates[int(choice)]
        print("Invalid choice, try again.")


def templatize(value: str, token_map: dict[str, str]) -> str:
    for token, literal in token_map.items():
        if literal:
            value = value.replace(literal, token)
    return value


def build_template(candidate: dict) -> dict:
    print(
        "\nNow tell me the exact values you used, so I can turn this request "
        "into a reusable template. Leave blank if not applicable."
    )
    date_value = input("Travel date you searched (e.g. 2026-07-10): ").strip()
    origin_value = input("Origin code you used (e.g. BLR): ").strip()
    dest_value = input("Destination code you used (e.g. NAG): ").strip()

    token_map = {
        "{DATE}": date_value,
        "{ORIGIN}": origin_value,
        "{DEST}": dest_value,
    }

    url_template = templatize(candidate["url"], token_map)
    post_data_template = (
        templatize(candidate["post_data"], token_map) if candidate["post_data"] else None
    )
    headers = {
        k: v for k, v in candidate["headers"].items() if k.lower() not in VOLATILE_HEADERS
    }

    print("\nResulting URL template:")
    print(" ", url_template)
    if post_data_template:
        print("Resulting body template:")
        print(" ", post_data_template)
    confirm = input("\nDoes this look right (placeholders show where date/origin/dest go)? [y/N] ")
    if confirm.strip().lower() != "y":
        print("Aborting - re-run and try again, or edit session_profile.json by hand.")
        sys.exit(1)

    return {
        "method": candidate["method"],
        "url_template": url_template,
        "headers": headers,
        "post_data_template": post_data_template,
    }


def detect_repo() -> tuple[str, str] | None:
    try:
        url = subprocess.check_output(
            ["git", "remote", "get-url", "origin"], cwd=REPO_ROOT, text=True
        ).strip()
    except Exception:
        return None
    match = re.search(r"[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?$", url)
    if not match:
        return None
    return match.group(1), match.group(2)


def push_secret_to_github(value: str) -> None:
    try:
        from nacl import encoding, public
    except ImportError:
        print("\npynacl not installed - skipping automatic secret push.")
        print(f"Install it (`pip install pynacl`) or manually set the '{SECRET_NAME}' secret.")
        return

    repo_info = detect_repo()
    if not repo_info:
        print("\nCouldn't detect owner/repo from git remote - skipping automatic secret push.")
        return
    owner, repo = repo_info

    token = input(
        f"\nGitHub token with permission to write secrets for {owner}/{repo} "
        "(leave blank to skip auto-push): "
    ).strip() or getpass.getpass("Token (hidden input): ")
    if not token:
        print(f"Skipping push - manually set the '{SECRET_NAME}' secret with this value:\n")
        print(value)
        return

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    pk_resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/actions/secrets/public-key",
        headers=headers,
        timeout=15,
    )
    pk_resp.raise_for_status()
    pk = pk_resp.json()

    public_key = public.PublicKey(pk["key"].encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(public_key)
    encrypted = sealed_box.encrypt(value.encode("utf-8"))
    encrypted_value = base64.b64encode(encrypted).decode("utf-8")

    put_resp = requests.put(
        f"https://api.github.com/repos/{owner}/{repo}/actions/secrets/{SECRET_NAME}",
        headers=headers,
        json={"encrypted_value": encrypted_value, "key_id": pk["key_id"]},
        timeout=15,
    )
    if put_resp.status_code in (201, 204):
        print(f"\nPushed '{SECRET_NAME}' secret to {owner}/{repo} via the GitHub API.")
    else:
        print(f"\nGitHub API call failed ({put_resp.status_code}): {put_resp.text}")
        print(f"Manually set the '{SECRET_NAME}' secret with the value below instead:\n")
        print(value)


def main() -> None:
    candidates, cookies = capture_candidates()
    candidate = pick_candidate(candidates)
    request_template = build_template(candidate)

    profile = {"cookies": cookies, "request_template": request_template}
    SESSION_PROFILE_PATH.write_text(json.dumps(profile, indent=2))
    print(f"\nSaved {SESSION_PROFILE_PATH} (gitignored, local only).")

    encoded = base64.b64encode(json.dumps(profile).encode("utf-8")).decode("utf-8")
    push_secret_to_github(encoded)


if __name__ == "__main__":
    main()
