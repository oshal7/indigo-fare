const CHEAP_THRESHOLD = 3000;
const STALE_DAYS = 3;

const directionFilter = document.getElementById("direction-filter");
const tbody = document.getElementById("fares-body");
const lastUpdatedEl = document.getElementById("last-updated");
const staleWarningEl = document.getElementById("stale-warning");
const emptyStateEl = document.getElementById("empty-state");

let allFares = [];

async function loadFares() {
  const res = await fetch("data/fares.json", { cache: "no-store" });
  const doc = await res.json();
  allFares = Object.values(doc.fares || {});

  if (doc.last_updated) {
    const updated = new Date(doc.last_updated);
    lastUpdatedEl.textContent = `Data as of: ${updated.toLocaleString()}`;
    const ageDays = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
    staleWarningEl.hidden = ageDays <= STALE_DAYS;
  } else {
    lastUpdatedEl.textContent = "No data yet.";
  }

  render();
}

function render() {
  const direction = directionFilter.value;
  const filtered = allFares
    .filter((f) => direction === "all" || `${f.origin}-${f.destination}` === direction)
    .sort((a, b) => a.bluechip_price - b.bluechip_price);

  tbody.innerHTML = "";
  emptyStateEl.hidden = filtered.length > 0;

  for (const f of filtered) {
    const tr = document.createElement("tr");
    if (f.bluechip_price <= CHEAP_THRESHOLD) tr.classList.add("cheap");

    tr.innerHTML = `
      <td>${f.date}</td>
      <td>${f.origin} &rarr; ${f.destination}</td>
      <td>${f.flight_number}</td>
      <td>${f.departure_time}</td>
      <td>${f.arrival_time}</td>
      <td>${f.bluechip_price}</td>
      <td>${new Date(f.last_checked_at).toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  }
}

directionFilter.addEventListener("change", render);
loadFares();
