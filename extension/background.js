/*
 * Orchestrates an on-demand scan: for every route/direction/month in the
 * configured window, navigates a background tab to the learned search URL
 * template and asks content.js to scrape the rendered page. Real tab
 * navigation means cookies (even HttpOnly ones) and IndiGo's own
 * bot-protection checks are handled exactly as they would be for normal
 * browsing - nothing here ever reads a cookie value or replays a raw API
 * call.
 */

const DEFAULT_CONFIG = {
  routes: [{ origin: "BLR", destination: "NAG", label: "Bangalore ⇋ Nagpur" }],
  scan_window_days: 180,
  max_points_baseline: 6000,
  booking_url_template:
    "https://www.goindigo.in/booking-search/book?from={origin}&to={destination}&date={date}&flightNo={flight_number}",
};

async function getConfig() {
  const stored = await chrome.storage.sync.get("config");
  return stored.config || DEFAULT_CONFIG;
}

async function getUrlTemplate() {
  const stored = await chrome.storage.local.get("urlTemplate");
  return stored.urlTemplate || null;
}

function monthStartDates(windowDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const months = [];
  const seen = new Set();
  const cursor = new Date(today);
  let daysCovered = 0;
  while (daysCovered < windowDays) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    if (!seen.has(key)) {
      months.push(new Date(cursor));
      seen.add(key);
    }
    cursor.setMonth(cursor.getMonth() + 1, 1);
    daysCovered = Math.round((cursor - today) / 86400000);
  }
  return months;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function fillTemplate(template, tokenMap) {
  let result = template;
  for (const [token, value] of Object.entries(tokenMap)) {
    result = result.split(token).join(value);
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);
  });
}

async function scrapeOneSearch(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id);
    await sleep(3000); // let the SPA finish its own AJAX render after navigation
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE" });
    await chrome.storage.local.set({
      lastDebugScrape: { url, candidates: response?.candidates || [], rawHints: response?.rawHints || [] },
    });
    return response?.candidates || [];
  } catch (e) {
    return [];
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runScan(onProgress) {
  const config = await getConfig();
  const template = await getUrlTemplate();
  if (!template) {
    throw new Error("No search URL learned yet - run the \"Learn\" step first.");
  }

  const months = monthStartDates(config.scan_window_days);
  const today = isoDate(new Date());
  const allDeals = [];
  let step = 0;
  const totalSteps = config.routes.length * 2 * months.length;

  for (const route of config.routes) {
    for (const [origin, destination] of [
      [route.origin, route.destination],
      [route.destination, route.origin],
    ]) {
      for (const monthDate of months) {
        step++;
        const dateStr = isoDate(monthDate);
        onProgress?.(step, totalSteps, `${origin}→${destination} ${dateStr}`);

        const url = fillTemplate(template, { "{ORIGIN}": origin, "{DEST}": destination, "{DATE}": dateStr });
        const candidates = await scrapeOneSearch(url);
        for (const c of candidates) {
          allDeals.push({
            origin,
            destination,
            date: c.date || dateStr,
            flight_number: c.flightNumber,
            departure_time: c.departureTime,
            points: c.points,
          });
        }

        await sleep(2500 + Math.random() * 2500);
      }
    }
  }

  const deduped = new Map();
  for (const deal of allDeals) {
    if (deal.date < today) continue;
    if (config.max_points_baseline != null && deal.points > config.max_points_baseline) continue;
    const key = `${deal.date}|${deal.origin}-${deal.destination}|${deal.flight_number}`;
    deal.booking_url = fillTemplate(config.booking_url_template, {
      "{origin}": deal.origin,
      "{destination}": deal.destination,
      "{date}": deal.date,
      "{flight_number}": deal.flight_number,
    });
    deduped.set(key, deal);
  }

  const deals = [...deduped.values()].sort((a, b) => a.points - b.points);
  const result = { last_updated: new Date().toISOString(), deals };
  await chrome.storage.local.set({ lastResult: result });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_SCAN") {
    runScan((step, total, label) => {
      chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", step, total, label }).catch(() => {});
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // keep the message channel open for the async response
  }
});
