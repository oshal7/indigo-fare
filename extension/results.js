const lastUpdatedEl = document.getElementById("last-updated");
const filterRouteEl = document.getElementById("filter-route");
const sortByEl = document.getElementById("sort-by");
const bannerAreaEl = document.getElementById("banner-area");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const scanBtn = document.getElementById("scan-btn");

let currentResult = null;

function routeKey(d) {
  return `${d.origin}-${d.destination}`;
}

function populateRouteFilter(deals) {
  const routes = [...new Set(deals.map(routeKey))].sort();
  const previous = filterRouteEl.value;
  filterRouteEl.innerHTML =
    '<option value="">All routes</option>' + routes.map((r) => `<option value="${r}">${r.replace("-", " → ")}</option>`).join("");
  if (routes.includes(previous)) filterRouteEl.value = previous;
}

function render() {
  if (!currentResult) {
    emptyEl.hidden = false;
    return;
  }

  lastUpdatedEl.textContent = `Last scan: ${new Date(currentResult.last_updated).toLocaleString()}`;

  bannerAreaEl.innerHTML = currentResult.session_expired
    ? '<div class="banner">Your IndiGo session expired mid-scan - log into goindigo.in again, then tap "Scan now".</div>'
    : "";

  let deals = currentResult.deals || [];
  populateRouteFilter(deals);

  const routeFilter = filterRouteEl.value;
  if (routeFilter) deals = deals.filter((d) => routeKey(d) === routeFilter);

  deals = [...deals].sort((a, b) =>
    sortByEl.value === "date" ? a.date.localeCompare(b.date) : a.points - b.points
  );

  if (deals.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent = currentResult.deals.length === 0
      ? "No deals captured yet. Run a scan from here or from the toolbar popup."
      : "No deals match this filter.";
    listEl.innerHTML = "";
    return;
  }
  emptyEl.hidden = true;

  const newKeys = new Set(currentResult.new_deal_keys || []);
  listEl.innerHTML = deals
    .map((d) => {
      const key = `${d.date}|${d.origin}-${d.destination}|${d.flight_number}`;
      return `
        <a class="deal" href="${d.booking_url}" target="_blank">
          <div class="left">
            <div>
              <div class="route">${d.origin} → ${d.destination} · ${d.date}</div>
              <div class="sub">${d.flight_number || ""} ${d.departure_time || ""}</div>
            </div>
            ${newKeys.has(key) ? '<span class="pill">NEW</span>' : ""}
          </div>
          <span class="points">${d.points} pts</span>
        </a>`;
    })
    .join("");
}

filterRouteEl.addEventListener("change", render);
sortByEl.addEventListener("change", render);

scanBtn.addEventListener("click", () => {
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning...";
  chrome.runtime.sendMessage({ type: "START_SCAN" }, (response) => {
    scanBtn.disabled = false;
    scanBtn.textContent = "Scan now";
    if (response?.ok) {
      currentResult = response.result;
      render();
    }
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SCAN_PROGRESS") {
    scanBtn.textContent = `${msg.step}/${msg.total}...`;
  }
});

(async function init() {
  const stored = await chrome.storage.local.get("lastResult");
  currentResult = stored.lastResult || null;
  render();
})();
