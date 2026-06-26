# IndiGo BluChip Fare Tracker - Chrome Extension

An on-demand alternative to the phone-bookmarklet + GitHub Actions pipeline
described in the repo's main README. Runs entirely inside your own desktop
Chrome session - no GitHub secrets, no static site, no cloud engine.

## Why this instead of the bookmarklet/cloud pipeline

- **No HttpOnly cookie problem.** The cloud pipeline needs the raw session
  cookie value to replay a request from a separate Python process, which
  fails if IndiGo marks the cookie `HttpOnly` (a JS-readability restriction).
  This extension never reads cookie values at all - it navigates real
  background browser tabs to IndiGo's own search pages, so the browser
  attaches cookies (HttpOnly or not) the same way it would for you browsing
  normally.
- **No reverse-engineered API call.** The repo's main README notes a plain
  HTTP request to goindigo.in returned `403 Forbidden` during research,
  likely IndiGo's bot protection. A real tab navigation looks like genuine
  browsing, not a scripted call.
- **Trade-off:** this only works on desktop/laptop Chrome (or other
  Chromium browsers) - Chrome on Android/iOS doesn't support extensions.

## Install (unpacked, for personal use)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**, select this `extension/` folder.
4. Pin the extension icon for easy access.

## Use

1. **Learn the search URL (one-time, or whenever IndiGo changes its site).**
   In a normal tab, log into `goindigo.in` and run one manual BluChip fare
   search for any date on one of your routes. Switch to the extension
   popup, type in exactly the date/origin/destination you searched, and
   tap **Learn from active tab**. It string-replaces those exact values in
   the tab's URL with `{DATE}`/`{ORIGIN}`/`{DEST}` placeholders and saves
   the template locally (`chrome.storage.local`, never leaves your machine).
2. **Scan.** Tap **Scan now** (from the popup or the full results page). It
   opens a background tab per route/direction/month across your configured
   window, waits for each page to render, asks the page to scrape the
   BluChip price, then closes the tab and moves to the next (with a
   2.5-5s randomized delay between each, same spirit as the cloud engine's
   rate limiting). The toolbar badge shows the deal count, and the popup
   shows the cheapest 6 with a link to the full results page for the rest.
3. **Settings** (gear/link in the popup) lets you edit routes, the scan
   window, the points baseline, the booking URL template, and automatic
   background scanning - same route/window/baseline shape as the main
   repo's `config.json`.

## Automatic background scanning

Settings has a toggle for **automatic background scanning** (every 6/12/24
hours, via `chrome.alarms`). While enabled and Chrome is running (it doesn't
scan while Chrome is fully closed), the extension reruns the scan
unattended and:

- Shows a **desktop notification** when new deals appear that weren't in
  the previous scan (deduped by date + route + flight number, so you're
  not renotified for the same deal every cycle).
- Updates the **toolbar badge** with the current deal count.
- If your IndiGo session has expired mid-scan (detected via a login-wall
  check - a password field or "session expired"/"please log in" text on
  the page), it stops the scan immediately, shows a session-expired
  notification and toolbar badge, and surfaces a banner in the popup and
  results page telling you to log into `goindigo.in` again and re-scan.

## Full results page

The popup only shows the top 6 deals. Click **Open full results page** (or
the toolbar popup's link) for a dedicated tab listing every deal, with
filtering by route and sorting by points or date. Deals new since the last
scan are marked **NEW**.

## The DOM scraper is a heuristic - expect to tune it once

Nobody has captured what IndiGo's real results page actually looks like
yet, so `content.js` doesn't use hardcoded CSS selectors. Instead it walks
the page's text nodes for anything mentioning "BluChip"/"points", then
regexes the surrounding card text for a number, flight code (`6E1234`
style), time, and date.

If a scan returns 0 matches (or wrong numbers) on a route you know has
deals, open the popup and click **Show last scrape debug** - it dumps the
raw candidate matches and `rawHints` (text snippets near every "chip"/
"point" mention found on the last page checked) from
`chrome.storage.local.lastDebugScrape`. Use that to tighten the regexes in
`content.js` (`POINTS_NEAR_KEYWORD_RE`, `FLIGHT_RE`, `TIME_RE`, `DATE_RE`).

If the **Learn** step itself fails ("couldn't find those values in the
tab's URL"), IndiGo's search page likely keeps origin/destination/date in
a client-side state (e.g. after a redirect to a path without query params)
rather than the URL - in that case the template approach needs adapting to
re-trigger the search via the page's own form/state instead of a
direct URL, which isn't built yet.
