# IndiGo BluChip Fare Tracker (BLR &harr; NAG)

Tracks the cheapest IndiGo BluChip (loyalty point) redemption prices for
flights between Bangalore (BLR) and Nagpur (NAG), in either direction,
across a rolling 6-month window - and shows them sorted cheapest-first on a
small GitHub Pages site.

IndiGo has no public fare API, and BluChip price is only visible when
logged into your own IndiGo account with the "Redeem BluChips" toggle on
during search. So this works by reusing your logged-in browser session
(never your password) to check a rotating batch of dates/routes on a
schedule via GitHub Actions, and committing the results as JSON for the
site to display.

## How it works

1. You export your IndiGo login session once (locally, via a script that
   opens a real browser for you to log into).
2. That session is stored as a GitHub Actions secret.
3. A scheduled GitHub Action loads the session, checks a batch of upcoming
   dates for both routes, and commits the results to `data/fares.json`.
4. GitHub Pages serves `docs/index.html`, which reads that data and shows a
   sortable, filterable table.

Because checking all ~182 days x 2 routes every run would be slow and more
likely to get flagged by IndiGo's site, each run only checks a slice
(`BATCH_SIZE`, default 25) and rotates through the full window over
multiple runs (full refresh roughly every 1-2 weeks at a daily cron).

## Setup

### 1. Export your IndiGo session (local machine, not CI)

```bash
pip install -r requirements.txt
playwright install chromium
python scripts/export_session.py
```

A browser window opens. Log into goindigo.in yourself (handle OTP if
asked), confirm you're on your account/dashboard, then return to the
terminal and press Enter. This saves `storage_state.json` locally
(never committed - it's in `.gitignore`).

### 2. Add it as a GitHub secret

```bash
base64 -w0 storage_state.json > storage_state.b64.txt
```

In your repo: **Settings &rarr; Secrets and variables &rarr; Actions &rarr;
New repository secret**, name it `INDIGO_STORAGE_STATE_B64`, and paste the
contents of `storage_state.b64.txt`.

### 3. Enable GitHub Pages

**Settings &rarr; Pages &rarr; Source:** deploy from this branch, folder
`/docs`.

### 4. Verify selectors before trusting the schedule

The scraping selectors in `scripts/fetch_fares.py` are best-effort
placeholders (no live access to a logged-in IndiGo session was available
while writing this). Before relying on the scheduled job:

```bash
HEADLESS=0 BATCH_SIZE=2 python scripts/fetch_fares.py
```

Watch the browser navigate goindigo.in and fix any selector marked
`# SELECTOR:` in the script to match the real DOM (inspect via browser
devtools). Once it correctly scrapes a couple of flights, the scheduled
Action should work the same way.

### 5. Run it

The workflow runs daily by default (`.github/workflows/fetch-fares.yml`).
You can also trigger it manually from the Actions tab (`workflow_dispatch`).

## Re-authenticating

If a run fails with a `Session expired` error in the Actions log, your
stored session has gone stale. Repeat steps 1-2 above to refresh the
`INDIGO_STORAGE_STATE_B64` secret.

## Limitations and risks

- **No public API** - this scrapes an authenticated UI that IndiGo can
  change at any time without notice, which can silently break scraping.
- **Bot protection risk** - a plain HTTP request to goindigo.in returned
  `403 Forbidden`, suggesting bot-protection (e.g. an Akamai-style WAF).
  GitHub-hosted Actions runners use shared datacenter IPs that such
  protections often challenge or block, even with a valid session. This is
  unresolved/unverified until tested live. If runs start failing
  consistently with no session-expiry error, this is the likely cause - the
  documented fallback is switching the workflow to a
  [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners)
  on your own machine/network.
- **Session expiry** - by design there's no scripted login/OTP, so the
  session will eventually expire and needs manual refresh (see above).
- **Selectors need live verification** - see step 4 above.
- **Personal use only** - this automates your own account for your own
  tracking. Review IndiGo's Terms of Service regarding automated access;
  this is intended for low-frequency personal use, not resale or
  redistribution of fare data.

## Repo structure

```
indigo-fare/
├── .github/workflows/fetch-fares.yml   # scheduled scraper job
├── data/
│   ├── fares.json                      # canonical scraped data
│   └── scan_cursor.json                # rotating-batch progress
├── docs/                               # GitHub Pages site
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/fares.json                 # copy for Pages to fetch
├── scripts/
│   ├── export_session.py               # one-time/manual session export
│   └── fetch_fares.py                  # scheduled scraper
├── requirements.txt
└── .gitignore
```
