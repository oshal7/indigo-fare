# Personal Flight Deal Tracker (PFDT)

A hyper-focused, single-user tool that tracks IndiGo BluChip redemption
deals across a configured set of routes (default: Bangalore ⇋ Nagpur) over
a rolling 6-month window, and shows them as a flat feed sorted
cheapest-first - no calendars, no scrolling.

## Architecture

Three decoupled pieces:

1. **Mobile Session Grabber** (a bookmarklet + `docs/grab.html` +
   `docs/bookmarklet.js`) - entirely phone-based, no laptop, no script
   install. You log into IndiGo yourself on its own real page (handling OTP
   yourself - we never see or relay your password), tap a bookmarklet that
   captures the network request returning BluChip pricing while you do one
   manual search, then review and save it from `grab.html`, which pushes
   the result straight to your repo's `INDIGO_SESSION_PROFILE_B64` GitHub
   Actions secret via the GitHub API (encrypted client-side in the browser
   with the repo's public key, via `libsodium-wrappers`) - no manual
   copy-paste of cookies, no computer required.

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

### Alternative: Chrome extension (desktop, on-demand)

If you'd rather run this on-demand from a laptop/desktop instead of the
phone+cloud pipeline above, see [`extension/README.md`](extension/README.md).
It's self-contained - no GitHub secrets, no static site - and scans by
navigating real background tabs on goindigo.in (so it never needs to read a
cookie value, sidestepping the `HttpOnly` and bot-protection caveats noted
below). Trade-off: desktop Chrome only, no mobile.

### Why this doesn't ask for your IndiGo username/password

Login (and OTP) always happens on IndiGo's own real page in your own
browser - this repo's pages never see, store, or relay your credentials.
The bookmarklet only reads the session your browser already has *after*
you've logged in normally, the same way the old desktop "export cookies"
extensions work. This is simpler to build and safer than trying to script
around 2FA.

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

### 2. Grab a session (from your phone, no computer needed)

1. In your phone's browser, bookmark any page, then edit that bookmark and
   replace its URL with the bookmarklet code shown on `docs/grab.html`
   (open `https://oshal7.github.io/indigo-fare/grab.html` and copy it from
   the box there).
2. Open `goindigo.in`, log in and complete OTP as normal.
3. Tap the bookmark - a bar appears at the bottom of the page saying
   "Capture armed".
4. Run **one** BluChip-enabled fare search so the points price is on screen.
5. Tap **Export** in that bar - you'll land back on `grab.html` with the
   captured request(s) and cookies.
6. `grab.html` auto-picks the request that most likely holds the points
   price and pre-fills the date/origin/destination from it - just confirm
   those look right (only fix them if they're clearly wrong), paste in a
   GitHub personal access token (needs permission to write Actions secrets
   on this repo - create this **once** and reuse the same token on every
   future refresh), and tap **Save session secret**. If the automatic save
   fails (see CORS note below), it shows you a value to paste manually
   under **Settings → Secrets and variables → Actions** as
   `INDIGO_SESSION_PROFILE_B64` instead - still no computer required.

**If this doesn't work at all:** if the captured cookies come back empty
or the cloud engine still hits a login wall after a successful-looking
save, IndiGo's session cookie is likely marked `HttpOnly`, which no
JavaScript (including this bookmarklet) can ever read - a hard browser
security limit, not a bug to fix. There's no client-side workaround for
that; the next option is a cloud browser service (e.g. Browserbase,
Steel.dev) or a GitHub Codespace running a VNC-accessible browser, either
of which captures cookies at the browser-engine level instead of via JS.
Neither is built into this repo yet - ask for it if the bookmarklet turns
out not to work for your account.

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
the phone-based capture flow above (step 2) to refresh the secret. The
"Data is stale" banner on the site links straight to `grab.html` as a
shortcut.

## Security notes - read this

- **Make this repository Private.** Session cookies never get committed -
  they only ever live in the GitHub secret, briefly in your phone browser's
  memory while reviewing them on `grab.html`, and in the URL fragment
  during the handoff (fragments are never sent to any server) - but keeping
  the scraping logic and run history private is still good hygiene.
- The GitHub personal access token you paste into `grab.html` is used
  in-memory for that one save and is never written to `localStorage`,
  `sessionStorage`, or any request log - it's cleared as soon as the save
  attempt finishes (success or failure).
- **Important caveat the PRD gets wrong on standard GitHub plans:** marking
  the repo Private does **not** make the published GitHub Pages site
  private. On free/Pro/Team plans, a Pages site built from a private repo
  is still reachable by anyone who has (or guesses) its URL - restricting
  Pages visibility requires GitHub Enterprise Cloud. In practice this is
  low-risk here because the only things published to `docs/data.json` are
  flight dates/times/points/booking links - never cookies or tokens - but
  don't treat the published site itself as access-controlled.
- Session cookies/headers are never written into `data/data.json` or
  `docs/data.json` - only into the encrypted GitHub secret.
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
│   ├── grab.html                     # phone-based session capture: review + save
│   ├── grab.js
│   ├── bookmarklet.js                # loaded by the bookmarklet, runs on goindigo.in
│   └── data.json                     # copy for Pages to fetch
├── scripts/
│   └── fetch_deals.py                # cloud: replay template, parse, filter, sort
├── requirements.txt
└── .gitignore
```
