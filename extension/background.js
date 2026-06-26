/*
 * Orchestrates a scan (manual or alarm-triggered): for every
 * route/direction/month in the configured window, navigates a background
 * tab to the learned search URL template and asks content.js to scrape the
 * rendered page. Real tab navigation means cookies (even HttpOnly ones) and
 * IndiGo's own bot-protection checks are handled exactly as they would be
 * for normal browsing - nothing here ever reads a cookie value or replays a
 * raw API call.
 */

const ALARM_NAME = "periodicScan";

const DEFAULT_CONFIG = {
  routes: [{ origin: "BLR", destination: "NAG", label: "Bangalore ⇋ Nagpur" }],
  scan_window_days: 180,
  max_points_baseline: 6000,
  booking_url_template:
    "https://www.goindigo.in/booking-search/book?from={origin}&to={destination}&date={date}&flightNo={flight_number}",
  auto_scan: { enabled: false, interval_hours: 12 },
};

async function getConfig() {
  const stored = await chrome.storage.sync.get("config");
  const config = stored.config || {};
  return {
    ...DEFAULT_CONFIG,
    ...config,
    auto_scan: { ...DEFAULT_CONFIG.auto_scan, ...(config.auto_scan || {}) },
  };
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

function dealKey(d) {
  return `${d.date}|${d.origin}-${d.destination}|${d.flight_number}`;
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
      lastDebugScrape: {
        url,
        candidates: response?.candidates || [],
        rawHints: response?.rawHints || [],
        loginWall: !!response?.loginWall,
      },
    });
    return response || { candidates: [], rawHints: [], loginWall: false };
  } catch (e) {
    return { candidates: [], rawHints: [], loginWall: false };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runScan(onProgress) {
  const config = await getConfig();
  const template = await getUrlTemplate();
  if (!template) {
    throw new Error('No search URL learned yet - run the "Learn" step first.');
  }

  const months = monthStartDates(config.scan_window_days);
  const today = isoDate(new Date());
  const allDeals = [];
  let step = 0;
  const totalSteps = config.routes.length * 2 * months.length;
  let sessionExpired = false;

  scanLoop: for (const route of config.routes) {
    for (const [origin, destination] of [
      [route.origin, route.destination],
      [route.destination, route.origin],
    ]) {
      for (const monthDate of months) {
        step++;
        const dateStr = isoDate(monthDate);
        onProgress?.(step, totalSteps, `${origin}→${destination} ${dateStr}`);

        const url = fillTemplate(template, { "{ORIGIN}": origin, "{DEST}": destination, "{DATE}": dateStr });
        const { candidates, loginWall } = await scrapeOneSearch(url);
        if (loginWall) {
          sessionExpired = true;
          break scanLoop;
        }
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
    const key = dealKey(deal);
    deal.booking_url = fillTemplate(config.booking_url_template, {
      "{origin}": deal.origin,
      "{destination}": deal.destination,
      "{date}": deal.date,
      "{flight_number}": deal.flight_number,
    });
    deduped.set(key, deal);
  }

  const deals = [...deduped.values()].sort((a, b) => a.points - b.points);
  const result = {
    last_updated: new Date().toISOString(),
    deals,
    session_expired: sessionExpired,
    new_deal_keys: [],
  };

  await applyBadgeAndNotifications(result);
  await chrome.storage.local.set({ lastResult: result });
  return result;
}

async function applyBadgeAndNotifications(result) {
  if (result.session_expired) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "IndiGo session expired",
      message: "Log into goindigo.in again, then run Scan to resume tracking.",
    });
    return;
  }

  chrome.action.setBadgeText({ text: result.deals.length ? String(result.deals.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });

  const { seenDealKeys } = await chrome.storage.local.get("seenDealKeys");
  const seenSet = new Set(seenDealKeys || []);
  const fresh = result.deals.filter((d) => !seenSet.has(dealKey(d)));
  result.new_deal_keys = fresh.map(dealKey);

  // Skip the notification on the very first-ever scan (nothing to diff against yet).
  if (fresh.length > 0 && seenDealKeys) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${fresh.length} new BluChip deal${fresh.length > 1 ? "s" : ""} found`,
      message: fresh
        .slice(0, 3)
        .map((d) => `${d.origin}→${d.destination} ${d.date}: ${d.points} pts`)
        .join("\n"),
    });
  }

  await chrome.storage.local.set({ seenDealKeys: result.deals.map(dealKey) });
}

async function setAutoScanAlarm(enabled, intervalHours) {
  await chrome.alarms.clear(ALARM_NAME);
  if (enabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(60, (intervalHours || 12) * 60) });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runScan().catch((e) => console.error("Auto-scan failed:", e));
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  if (config.auto_scan.enabled) {
    setAutoScanAlarm(true, config.auto_scan.interval_hours);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_SCAN") {
    runScan((step, total, label) => {
      chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", step, total, label }).catch(() => {});
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // keep the message channel open for the async response
  }
  if (msg.type === "SET_AUTO_SCAN") {
    setAutoScanAlarm(msg.enabled, msg.intervalHours).then(() => sendResponse({ ok: true }));
    return true;
  }
});
