const DEFAULT_CONFIG = {
  routes: [{ origin: "BLR", destination: "NAG", label: "Bangalore ⇋ Nagpur" }],
  scan_window_days: 180,
  max_points_baseline: 6000,
  booking_url_template:
    "https://www.goindigo.in/booking-search/book?from={origin}&to={destination}&date={date}&flightNo={flight_number}",
  auto_scan: { enabled: false, interval_hours: 12 },
};

const routesEl = document.getElementById("routes");
const addRouteBtn = document.getElementById("add-route-btn");
const scanWindowEl = document.getElementById("scan-window-days");
const maxPointsEl = document.getElementById("max-points");
const bookingTemplateEl = document.getElementById("booking-template");
const autoScanEnabledEl = document.getElementById("auto-scan-enabled");
const autoScanIntervalEl = document.getElementById("auto-scan-interval");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind || ""}`;
}

function addRouteRow(route) {
  const row = document.createElement("div");
  row.className = "route-row";
  row.innerHTML = `
    <input type="text" class="route-origin" placeholder="BLR" value="${route?.origin || ""}" />
    <input type="text" class="route-dest" placeholder="NAG" value="${route?.destination || ""}" />
    <input type="text" class="route-label" placeholder="Label (optional)" value="${route?.label || ""}" />
    <button class="remove-btn" type="button" title="Remove">✕</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  routesEl.appendChild(row);
}

addRouteBtn.addEventListener("click", () => addRouteRow());

function readRoutesFromForm() {
  return [...routesEl.querySelectorAll(".route-row")]
    .map((row) => ({
      origin: row.querySelector(".route-origin").value.trim().toUpperCase(),
      destination: row.querySelector(".route-dest").value.trim().toUpperCase(),
      label: row.querySelector(".route-label").value.trim(),
    }))
    .filter((r) => r.origin && r.destination);
}

function validate(config) {
  if (!Array.isArray(config.routes) || config.routes.length === 0) {
    throw new Error("Add at least one route (origin + destination).");
  }
  if (!Number.isFinite(config.scan_window_days) || config.scan_window_days < 1) {
    throw new Error("Scan window must be a positive number of days.");
  }
  if (!config.booking_url_template) {
    throw new Error("Booking URL template can't be empty.");
  }
}

function buildConfig() {
  return {
    routes: readRoutesFromForm(),
    scan_window_days: Number(scanWindowEl.value),
    max_points_baseline: maxPointsEl.value === "" ? null : Number(maxPointsEl.value),
    booking_url_template: bookingTemplateEl.value.trim(),
    auto_scan: {
      enabled: autoScanEnabledEl.checked,
      interval_hours: Number(autoScanIntervalEl.value),
    },
  };
}

function populateForm(config) {
  routesEl.innerHTML = "";
  config.routes.forEach(addRouteRow);
  scanWindowEl.value = config.scan_window_days;
  maxPointsEl.value = config.max_points_baseline ?? "";
  bookingTemplateEl.value = config.booking_url_template;
  autoScanEnabledEl.checked = !!config.auto_scan?.enabled;
  autoScanIntervalEl.value = String(config.auto_scan?.interval_hours || 12);
}

async function saveConfig(config) {
  await chrome.storage.sync.set({ config });
  await chrome.runtime.sendMessage({
    type: "SET_AUTO_SCAN",
    enabled: config.auto_scan.enabled,
    intervalHours: config.auto_scan.interval_hours,
  });
}

document.getElementById("save-btn").addEventListener("click", async () => {
  try {
    const config = buildConfig();
    validate(config);
    await saveConfig(config);
    setStatus("Saved.", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  populateForm(DEFAULT_CONFIG);
  await saveConfig(DEFAULT_CONFIG);
  setStatus("Reset to default and saved.", "ok");
});

(async function init() {
  const stored = await chrome.storage.sync.get("config");
  populateForm(stored.config || DEFAULT_CONFIG);
})();
