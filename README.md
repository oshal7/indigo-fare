# Personal Flight Deal Tracker (PFDT)

A hyper-focused, single-user tool that tracks IndiGo BluChip redemption
deals across a configured set of routes (default: Bangalore ⇋ Nagpur) over
a rolling 6-month window, and shows them as a flat feed sorted
cheapest-first - no calendars, no scrolling.

## Architecture

Three decoupled pieces, per the PRD:

1. **Local Token Grabber** (`scripts/grab_token.py`) - run on your own
   machine. Opens a real browser for you to log into IndiGo (handling OTP
   yourself), captures the network request that returns BluChip pricing
   while you do one manual search, and turns it into a reusable template.
   Pushes the result straight to your repo's `INDIGO_SESSION_PROFILE_B64`
   GitHub Actions secret via the GitHub API (encrypted with the repo's
   public key) - no manual copy-paste of cookies.

2. **Cloud Engine** (`scripts/fetch_deals.py` + `.github/workflows/fetch-fares.yml`)
   - runs twice daily on GitHub Actions. Loads the session profile from the
   secret, replays the captured request once per month per route/direction
   across the 6-month window (sleeping 1.0-3.5s between calls to avoid
   hammering IndiGo), filters out anything above your configured points
   baseline, sorts ascending, and commits `data/data.json`.

3. **Static Web Client** (`docs/`) - a single Tailwind page on GitHub Pages
   that reads `data.json`, lets you switch between configured route pairs
   and directions, and lists deals as a flat feed with deep-link "Book ↗"
   buttons.

## Setup

### 1. Configure your routes

Edit `config.json`:

```json
{
  "routes": [{ "origin": "BLR", "destination": "NAG", "label": "Bangalore ⇋ Nagpur" }],
  "scan_window_days": 180,
  "max_points_baseline": 6000,
  "booking_url_template": "https://www.goindigo.in/booking-search/book?from={origin}&to={destination}&date={date}&flightNo={flight_number}"
}
```

Add more route objects to track additional pairs - the frontend's route
dropdown is generated from this list automatically.

### 2. Grab a session (local machine, not CI)

```bash
pip install -r requirements.txt
playwright install chromium
python scripts/grab_token.py
```

This opens a browser, you log in and run one manual BluChip search, then
the script asks you to confirm which captured network request had the
points price and helps build a template from it. It'll then ask for a
GitHub token (needs permission to write Actions secrets on this repo) to
push the result automatically - or it prints the value for you to paste in
manually under **Settings → Secrets and variables → Actions** as
`INDIGO_SESSION_PROFILE_B64`.

### 3. Verify the response parser

The very first run will write `data/debug_last_response.json` with the raw
JSON IndiGo returned. Open it and check `KEY_ALIASES` at the top of
`scripts/fetch_deals.py` actually matches the real field names (date,
points, flight number, times) - adjust if the generic extractor isn't
picking up deals. Same goes for `booking_url_template` in `config.json`:
it's a best-effort guess at IndiGo's deep-link format and needs checking
against a real booking URL.

### 4. Enable GitHub Pages

**Settings → Pages → Source:** deploy from this branch, folder `/docs`.

### 5. Run it

The workflow runs twice daily by default. Trigger it manually from the
Actions tab any time (`workflow_dispatch`).

## Re-authenticating

If a run fails with a `Session expired` error in the Actions log, repeat
step 2 to refresh the secret.

## Security notes - read this

- **Make this repository Private.** Even though session cookies never get
  committed (they only ever live in the GitHub secret and your local
  gitignored `session_profile.json`), keeping the scraping logic and run
  history private is good hygiene.
- **Important caveat the PRD gets wrong on standard GitHub plans:** marking
  the repo Private does **not** make the published GitHub Pages site
  private. On free/Pro/Team plans, a Pages site built from a private repo
  is still reachable by anyone who has (or guesses) its URL - restricting
  Pages visibility requires GitHub Enterprise Cloud. In practice this is
  low-risk here because the only things published to `docs/data.json` are
  flight dates/times/points/booking links - never cookies or tokens - but
  don't treat the published site itself as access-controlled.
- Session cookies/headers are never written into `data/data.json` or
  `docs/data.json` - only into the local `session_profile.json` (gitignored)
  and the encrypted GitHub secret.
- This automates your own account for personal tracking. Review IndiGo's
  Terms of Service on automated access; keep usage low-frequency and
  personal, not redistributed.
- A plain HTTP request to goindigo.in returned `403 Forbidden` during
  research, suggesting bot-protection. Replaying captured requests via
  `requests` from GitHub's shared runner IPs may still get challenged even
  with valid cookies - if runs fail consistently without a session-expiry
  error, this is the likely cause. Fallback: move the workflow to a
  [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners)
  on your own network.

## Repo structure

```
indigo-fare/
├── config.json                       # routes, scan window, points baseline, booking URL template
├── .github/workflows/fetch-fares.yml # twice-daily cloud engine
├── data/
│   └── data.json                     # canonical output
├── docs/                             # GitHub Pages site (Tailwind via CDN)
│   ├── index.html
│   ├── app.js
│   └── data.json                     # copy for Pages to fetch
├── scripts/
│   ├── grab_token.py                 # local: login, capture, templatize, push secret
│   └── fetch_deals.py                # cloud: replay template, parse, filter, sort
├── requirements.txt
└── .gitignore
```
