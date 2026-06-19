const DEFAULT_CONFIG = {
  routes: [{ origin: "BLR", destination: "NAG", label: "Bangalore ⇋ Nagpur" }],
  scan_window_days: 180,
  max_points_baseline: 6000,
  booking_url_template:
    "https://www.goindigo.in/booking-search/book?from={origin}&to={destination}&date={date}&flightNo={flight_number}",
};

const textEl = document.getElementById("config-text");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind || ""}`;
}

function validate(config) {
  if (!Array.isArray(config.routes) || config.routes.length === 0) throw new Error('"routes" must be a non-empty array.');
  for (const r of config.routes) {
    if (!r.origin || !r.destination) throw new Error("each route needs an origin and destination.");
  }
  if (typeof config.scan_window_days !== "number") throw new Error('"scan_window_days" must be a number.');
  if (typeof config.booking_url_template !== "string") throw new Error('"booking_url_template" must be a string.');
}

document.getElementById("save-btn").addEventListener("click", async () => {
  try {
    const config = JSON.parse(textEl.value);
    validate(config);
    await chrome.storage.sync.set({ config });
    setStatus("Saved.", "ok");
  } catch (e) {
    setStatus(`Invalid config: ${e.message}`, "err");
  }
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  textEl.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  await chrome.storage.sync.set({ config: DEFAULT_CONFIG });
  setStatus("Reset to default and saved.", "ok");
});

(async function init() {
  const stored = await chrome.storage.sync.get("config");
  textEl.value = JSON.stringify(stored.config || DEFAULT_CONFIG, null, 2);
})();
