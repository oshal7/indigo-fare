const OWNER = "oshal7";
const REPO = "indigo-fare";
const SECRET_NAME = "INDIGO_SESSION_PROFILE_B64";

// Same volatile-header set the old local grabber used - replaying these
// verbatim from a captured request usually breaks things on replay.
const VOLATILE_HEADERS = new Set(["content-length", "host", ":authority", ":method", ":path", ":scheme"]);

const noDataEl = document.getElementById("no-data");
const reviewEl = document.getElementById("review");
const requestListEl = document.getElementById("request-list");
const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const manualFallbackEl = document.getElementById("manual-fallback");
const manualValueEl = document.getElementById("manual-value");

const dateInput = document.getElementById("input-date");
const originInput = document.getElementById("input-origin");
const destInput = document.getElementById("input-dest");
const patInput = document.getElementById("input-pat");
const saveBtn = document.getElementById("save-btn");

let payload = null;
let selectedIndex = 0;

function decodePayload() {
  const hash = location.hash.slice(1);
  if (!hash) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(hash))));
  } catch (e) {
    return null;
  }
}

// Ranks captured requests so the one most likely holding the BluChip
// points price is pre-selected instead of leaving the user to guess.
function scoreRequest(req) {
  const hay = `${req.url} ${req.response || ""}`.toLowerCase();
  const hasPoint = /point|chip/.test(hay);
  const hasPrice = /fare|price|amount/.test(hay);
  let score = 0;
  if (hasPoint && hasPrice) score += 10;
  else if (hasPoint || hasPrice) score += 3;
  score += Math.min((req.response || "").length / 1000, 5);
  return score;
}

function pickBestIndex(requests) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  requests.forEach((req, i) => {
    const score = scoreRequest(req);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  return bestIndex;
}

function renderRequestList() {
  requestListEl.innerHTML = "";
  if (!payload.requests || payload.requests.length === 0) {
    requestListEl.innerHTML =
      '<p class="text-xs text-slate-500">No requests captured - cookies only. Make sure you ran a search before tapping Export.</p>';
    return;
  }
  payload.requests.forEach((req, i) => {
    const label = document.createElement("label");
    label.className = "flex items-start gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs";
    label.innerHTML = `
      <input type="radio" name="req" value="${i}" ${i === selectedIndex ? "checked" : ""} class="mt-0.5" />
      <span><span class="text-slate-200">${req.method}</span> ${req.url}${i === selectedIndex ? ' <span class="text-amber-400">(best match - pre-selected)</span>' : ""}</span>
    `;
    label.querySelector("input").addEventListener("change", () => {
      selectedIndex = i;
      updatePreview();
    });
    requestListEl.appendChild(label);
  });
}

// Best-effort scrape of the date/origin/destination from the selected
// request so the user only has to confirm, not type from scratch.
function autofillSearchFields(req) {
  const hay = `${req.url} ${req.body || ""}`;
  const dateMatch = hay.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateMatch && !dateInput.value) dateInput.value = dateMatch[1];

  const pairMatch = hay.match(/\b(?:org|origin|from|src)[=:"]+([A-Z]{3})\b/i);
  const destMatch = hay.match(/\b(?:dest|destination|to)[=:"]+([A-Z]{3})\b/i);
  if (pairMatch && !originInput.value) originInput.value = pairMatch[1].toUpperCase();
  if (destMatch && !destInput.value) destInput.value = destMatch[1].toUpperCase();
}

function templatize(value, tokenMap) {
  if (!value) return value;
  let result = value;
  for (const [token, literal] of Object.entries(tokenMap)) {
    if (literal) result = result.split(literal).join(token);
  }
  return result;
}

function buildTemplate() {
  const req = payload.requests[selectedIndex];
  const tokenMap = {
    "{DATE}": dateInput.value.trim(),
    "{ORIGIN}": originInput.value.trim(),
    "{DEST}": destInput.value.trim(),
  };
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (!VOLATILE_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  return {
    method: req.method,
    url_template: templatize(req.url, tokenMap),
    headers,
    post_data_template: templatize(req.body, tokenMap),
  };
}

function buildProfile() {
  const cookies = (payload.cookies || "")
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const idx = c.indexOf("=");
      return { name: c.slice(0, idx), value: c.slice(idx + 1) };
    });
  return { cookies, request_template: buildTemplate() };
}

function updatePreview() {
  if (!payload.requests || payload.requests.length === 0) {
    previewEl.textContent = "(no request captured)";
    return;
  }
  previewEl.textContent = JSON.stringify(buildProfile(), null, 2).slice(0, 1500);
}

[dateInput, originInput, destInput].forEach((el) => el.addEventListener("input", updatePreview));

async function saveToGithub() {
  const pat = patInput.value.trim();
  if (!pat) {
    statusEl.textContent = "Enter a GitHub token first.";
    statusEl.className = "text-sm text-red-300";
    return;
  }

  statusEl.textContent = "Saving...";
  statusEl.className = "text-sm text-slate-400";

  const profile = buildProfile();
  const encodedProfile = btoa(unescape(encodeURIComponent(JSON.stringify(profile))));

  try {
    await sodium.ready;

    const pkRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/secrets/public-key`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
    });
    if (!pkRes.ok) throw new Error(`public key fetch failed (${pkRes.status})`);
    const pk = await pkRes.json();

    const messageBytes = sodium.from_string(encodedProfile);
    const keyBytes = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
    const sealed = sodium.crypto_box_seal(messageBytes, keyBytes);
    const encryptedValue = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

    const putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/secrets/${SECRET_NAME}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: pk.key_id }),
    });
    if (!putRes.ok) throw new Error(`secret PUT failed (${putRes.status})`);

    statusEl.textContent = "Saved! The next scheduled run will use this session.";
    statusEl.className = "text-sm text-emerald-400";
    manualFallbackEl.hidden = true;
  } catch (e) {
    statusEl.textContent = `Automatic save failed (${e.message}). Use the manual fallback below.`;
    statusEl.className = "text-sm text-red-300";
    manualFallbackEl.hidden = false;
    manualValueEl.value = encodedProfile;
  } finally {
    patInput.value = "";
  }
}

saveBtn.addEventListener("click", saveToGithub);

payload = decodePayload();
if (payload) {
  noDataEl.hidden = true;
  reviewEl.hidden = false;
  if (payload.requests && payload.requests.length > 0) {
    selectedIndex = pickBestIndex(payload.requests);
    autofillSearchFields(payload.requests[selectedIndex]);
  }
  renderRequestList();
  updatePreview();
}
