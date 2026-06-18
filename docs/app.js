const STALE_HOURS = 24;

const routeSelect = document.getElementById("route-select");
const directionTabs = document.getElementById("direction-tabs");
const lastUpdatedEl = document.getElementById("last-updated");
const staleBannerEl = document.getElementById("stale-banner");
const dealsListEl = document.getElementById("deals-list");
const emptyStateEl = document.getElementById("empty-state");

let data = { routes: [], deals: [] };
let selectedRouteIndex = 0;
let selectedDirection = "forward"; // "forward" = origin->destination, "reverse" = destination->origin

function relativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

async function load() {
  const res = await fetch("data.json", { cache: "no-store" });
  data = await res.json();

  if (data.last_updated_timestamp) {
    lastUpdatedEl.textContent = `Last Updated: ${relativeTime(data.last_updated_timestamp)}`;
    const ageHours = (Date.now() - new Date(data.last_updated_timestamp).getTime()) / (1000 * 60 * 60);
    staleBannerEl.hidden = ageHours <= STALE_HOURS;
  } else {
    lastUpdatedEl.textContent = "No data yet.";
  }

  renderRouteOptions();
  renderDirectionTabs();
  render();
}

function renderRouteOptions() {
  routeSelect.innerHTML = "";
  data.routes.forEach((route, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = route.label || `${route.origin} ⇋ ${route.destination}`;
    routeSelect.appendChild(opt);
  });
  routeSelect.value = selectedRouteIndex;
}

function currentRoute() {
  return data.routes[selectedRouteIndex] || { origin: "", destination: "" };
}

function renderDirectionTabs() {
  const route = currentRoute();
  directionTabs.innerHTML = "";

  const forwardBtn = document.createElement("button");
  forwardBtn.textContent = `⚡ ${route.origin} → ${route.destination}`;
  forwardBtn.dataset.direction = "forward";

  const reverseBtn = document.createElement("button");
  reverseBtn.textContent = `${route.destination} → ${route.origin}`;
  reverseBtn.dataset.direction = "reverse";

  [forwardBtn, reverseBtn].forEach((btn) => {
    btn.className = "rounded-lg py-2 text-sm font-medium transition";
    btn.addEventListener("click", () => {
      selectedDirection = btn.dataset.direction;
      updateTabStyles();
      render();
    });
    directionTabs.appendChild(btn);
  });

  updateTabStyles();
}

function updateTabStyles() {
  for (const btn of directionTabs.children) {
    const active = btn.dataset.direction === selectedDirection;
    btn.className =
      "rounded-lg py-2 text-sm font-medium transition " +
      (active ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300");
  }
}

function render() {
  const route = currentRoute();
  const [origin, destination] =
    selectedDirection === "forward" ? [route.origin, route.destination] : [route.destination, route.origin];

  const filtered = data.deals
    .filter((d) => d.origin === origin && d.destination === destination)
    .sort((a, b) => a.points - b.points);

  dealsListEl.innerHTML = "";
  emptyStateEl.hidden = filtered.length > 0;

  for (const deal of filtered) {
    const li = document.createElement("li");
    li.className =
      "flex items-center justify-between bg-slate-900 rounded-xl px-3 py-2 border border-slate-800";
    li.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-amber-400 font-bold text-sm">${deal.points.toLocaleString()} BC</span>
        <span class="text-slate-300 text-sm">${formatDate(deal.date)}</span>
        <span class="text-slate-500 text-xs">${deal.departure_time || ""}</span>
      </div>
      <a href="${deal.booking_url}" target="_blank" rel="noopener"
         class="text-xs font-semibold text-sky-400 hover:text-sky-300">Book ↗</a>
    `;
    dealsListEl.appendChild(li);
  }
}

routeSelect.addEventListener("change", () => {
  selectedRouteIndex = Number(routeSelect.value);
  renderDirectionTabs();
  render();
});

load();
