const learnBtn = document.getElementById("learn-btn");
const learnStatus = document.getElementById("learn-status");
const learnDate = document.getElementById("learn-date");
const learnOrigin = document.getElementById("learn-origin");
const learnDest = document.getElementById("learn-dest");

const scanBtn = document.getElementById("scan-btn");
const scanStatus = document.getElementById("scan-status");
const resultsEl = document.getElementById("results");

const debugLink = document.getElementById("debug-link");
const debugPre = document.getElementById("debug-pre");
const optionsLink = document.getElementById("options-link");

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status ${kind || ""}`;
}

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

debugLink.addEventListener("click", async () => {
  const { lastDebugScrape } = await chrome.storage.local.get("lastDebugScrape");
  debugPre.hidden = false;
  debugPre.textContent = lastDebugScrape ? JSON.stringify(lastDebugScrape, null, 2) : "No scan run yet.";
});

learnBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("goindigo.in")) {
    setStatus(learnStatus, "Switch to the IndiGo search results tab first.", "err");
    return;
  }
  const date = learnDate.value.trim();
  const origin = learnOrigin.value.trim().toUpperCase();
  const dest = learnDest.value.trim().toUpperCase();
  if (!date || !origin || !dest) {
    setStatus(learnStatus, "Fill in the date/origin/destination you actually searched.", "err");
    return;
  }
  if (!tab.url.includes(date) || !tab.url.toUpperCase().includes(origin) || !tab.url.toUpperCase().includes(dest)) {
    setStatus(learnStatus, "Couldn't find those values in the tab's URL - double check them, or this site may pass search params another way (see Settings note).", "err");
    return;
  }

  let template = tab.url;
  template = template.split(date).join("{DATE}");
  template = template.split(new RegExp(origin, "gi")).join("{ORIGIN}");
  template = template.split(new RegExp(dest, "gi")).join("{DEST}");
  await chrome.storage.local.set({ urlTemplate: template });
  setStatus(learnStatus, "Learned! You can scan now.", "ok");
});

scanBtn.addEventListener("click", () => {
  resultsEl.innerHTML = "";
  setStatus(scanStatus, "Scanning...", "muted");
  chrome.runtime.sendMessage({ type: "START_SCAN" }, (response) => {
    if (!response) {
      setStatus(scanStatus, "No response from background worker - try again.", "err");
      return;
    }
    if (!response.ok) {
      setStatus(scanStatus, `Failed: ${response.error}`, "err");
      return;
    }
    renderResults(response.result);
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SCAN_PROGRESS") {
    setStatus(scanStatus, `Checking ${msg.label} (${msg.step}/${msg.total})...`, "muted");
  }
});

function renderResults(result) {
  if (!result.deals.length) {
    resultsEl.innerHTML = '<p>No deals found under the points baseline. Check "Show last scrape debug" if this looks wrong.</p>';
    setStatus(scanStatus, `Done - 0 matches (${new Date(result.last_updated).toLocaleString()})`, "muted");
    return;
  }
  setStatus(scanStatus, `Done - ${result.deals.length} matches (${new Date(result.last_updated).toLocaleString()})`, "ok");
  resultsEl.innerHTML = result.deals
    .map(
      (d) => `
      <a class="deal" href="${d.booking_url}" target="_blank">
        <div class="top">
          <span>${d.origin} → ${d.destination} · ${d.date}</span>
          <span class="points">${d.points} pts</span>
        </div>
        <div class="meta">${d.flight_number || ""} ${d.departure_time || ""}</div>
      </a>`
    )
    .join("");
}

(async function init() {
  const stored = await chrome.storage.local.get(["lastResult", "urlTemplate"]);
  if (stored.urlTemplate) {
    setStatus(learnStatus, "Template already learned - re-learn anytime if IndiGo changes its site.", "muted");
  }
  if (stored.lastResult) renderResults(stored.lastResult);
})();
