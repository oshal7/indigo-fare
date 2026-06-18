"""
One-time (and re-run-when-expired) local helper.

Opens a real, visible Chromium window so you can log into goindigo.in
yourself (handling OTP if prompted), then saves the logged-in session
(cookies + localStorage) to storage_state.json. That file is what lets
the unattended GitHub Actions job browse IndiGo without ever seeing a
username/password or OTP.

Run locally:
    pip install -r requirements.txt
    playwright install chromium
    python scripts/export_session.py

Never commit the resulting storage_state.json - it's already in .gitignore.
After running this, base64-encode it and update the INDIGO_STORAGE_STATE_B64
GitHub secret (see README.md).
"""

from playwright.sync_api import sync_playwright

OUTPUT_PATH = "storage_state.json"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto("https://www.goindigo.in/")

        input(
            "\nA browser window has opened.\n"
            "1. Log into your IndiGo account (complete OTP if asked).\n"
            "2. Make sure you land on your account/dashboard (logged-in state).\n"
            "3. Come back here and press Enter to save the session...\n"
        )

        context.storage_state(path=OUTPUT_PATH)
        browser.close()

    print(f"Saved session to {OUTPUT_PATH}")
    print("Next: base64-encode it and update the INDIGO_STORAGE_STATE_B64 secret.")
    print("  base64 -w0 storage_state.json > storage_state.b64.txt")


if __name__ == "__main__":
    main()
