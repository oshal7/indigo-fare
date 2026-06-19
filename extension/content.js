/*
 * Injected into goindigo.in pages. Only acts when asked via a "SCRAPE"
 * message from background.js (after it navigates a background tab to a
 * search-results URL) - never runs unprompted, so it doesn't slow down or
 * interfere with normal browsing on the site.
 *
 * The DOM structure of IndiGo's results page is unknown until a real scan
 * has been run, so this uses a generic heuristic (find text mentioning
 * BluChips/points, then read the surrounding card's text for a number,
 * flight code, time, date) instead of hardcoded CSS selectors. If results
 * come back empty or wrong on a real page, inspect `rawHints` returned
 * alongside `candidates` (also saved as chrome.storage.local.lastDebugScrape
 * by background.js) to see what text near "chip"/"point" actually looks
 * like, then tighten the regexes below.
 */

const KEYWORD_RE = /(blu\s*-?\s*chip|bluechip|points?)/i;
const POINTS_NEAR_KEYWORD_RE = /(\d{2,6})\s*(?:blu\s*-?\s*chips?|points?)/i;
const FLIGHT_RE = /\b(6E[\s-]?\d{3,4})\b/i;
const TIME_RE = /\b(\d{1,2}:\d{2}\s?(?:AM|PM)?)\b/i;
const DATE_RE = /\b(20\d{2}-\d{2}-\d{2})\b/;

function nearestCardText(textNode) {
  let el = textNode.parentElement;
  let cardText = "";
  for (let i = 0; i < 5 && el; i++) {
    cardText = el.innerText || "";
    if (cardText.length > 40) break;
    el = el.parentElement;
  }
  return cardText;
}

function scrapeBluChipCandidates() {
  const candidates = [];
  const rawHints = [];
  const seen = new Set();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text || !KEYWORD_RE.test(text)) continue;

    const cardText = nearestCardText(node);
    if (seen.has(cardText)) continue;
    seen.add(cardText);

    rawHints.push(cardText.slice(0, 300));

    const numberMatch = cardText.match(POINTS_NEAR_KEYWORD_RE);
    if (!numberMatch) continue;
    const points = parseInt(numberMatch[1], 10);
    if (!Number.isFinite(points)) continue;

    candidates.push({
      points,
      flightNumber: (cardText.match(FLIGHT_RE) || [])[1] || "",
      departureTime: (cardText.match(TIME_RE) || [])[1] || "",
      date: (cardText.match(DATE_RE) || [])[1] || "",
      snippet: cardText.slice(0, 300),
    });
  }

  return { candidates, rawHints: rawHints.slice(0, 20) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE") {
    sendResponse({ url: location.href, ...scrapeBluChipCandidates() });
  }
});
