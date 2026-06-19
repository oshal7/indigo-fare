/*
 * Loaded by the "Grab IndiGo Session" bookmarklet (see docs/grab.html).
 * Runs on goindigo.in itself - never on our own origin - to capture the
 * BluChip session and the network request/response that returns points
 * pricing, then hands it off to grab.js via a URL fragment (never sent
 * over the network).
 */
(function () {
  if (window.__indigoCaptureArmed) {
    alert("Capture already armed - run your search, then tap Export.");
    return;
  }
  window.__indigoCaptureArmed = true;

  var GRAB_URL = "https://oshal7.github.io/indigo-fare/grab.html";
  var KEYWORDS = ["point", "chip", "fare", "price", "amount", "flight", "segment"];
  var MAX_CAPTURED = 6;
  var captured = [];

  function looksRelevant(url, body) {
    var hay = (url + " " + (body || "")).toLowerCase();
    for (var i = 0; i < KEYWORDS.length; i++) {
      if (hay.indexOf(KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  function headersToObject(headers) {
    var out = {};
    if (!headers) return out;
    try {
      new Headers(headers).forEach(function (value, key) {
        out[key] = value;
      });
    } catch (e) {}
    return out;
  }

  function updateButton() {
    var btn = document.getElementById("__capExportBtn");
    if (btn) btn.textContent = "Export (" + captured.length + " captured)";
  }

  function record(entry) {
    if (captured.length < MAX_CAPTURED) captured.push(entry);
    updateButton();
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = (init && init.method) || "GET";
    var body = (init && init.body) || null;
    var headers = headersToObject(init && init.headers);
    return origFetch.apply(this, arguments).then(function (res) {
      res
        .clone()
        .text()
        .then(function (text) {
          if (looksRelevant(url, text)) {
            record({ url: url, method: method, body: body, headers: headers, response: text.slice(0, 4000) });
          }
        })
        .catch(function () {});
      return res;
    });
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__capMethod = method;
    this.__capUrl = url;
    this.__capHeaders = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    this.__capHeaders = this.__capHeaders || {};
    this.__capHeaders[name] = value;
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    xhr.addEventListener("load", function () {
      try {
        if (looksRelevant(xhr.__capUrl, xhr.responseText)) {
          record({
            url: xhr.__capUrl,
            method: xhr.__capMethod,
            body: body || null,
            headers: xhr.__capHeaders || {},
            response: (xhr.responseText || "").slice(0, 4000),
          });
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };

  var bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#0f172a;" +
    "color:#fff;padding:10px 12px;font:14px/1.4 -apple-system,sans-serif;" +
    "text-align:center;border-top:2px solid #f59e0b;box-shadow:0 -2px 10px rgba(0,0,0,.4)";
  bar.innerHTML =
    "Capture armed - run your BluChip search now.<br>" +
    '<button id="__capExportBtn" style="margin-top:8px;background:#f59e0b;color:#0f172a;' +
    'border:none;padding:8px 16px;border-radius:8px;font-weight:bold;font-size:14px">Export (0 captured)</button>';
  document.body.appendChild(bar);

  document.getElementById("__capExportBtn").addEventListener("click", function () {
    if (captured.length === 0 && !confirm("Nothing captured yet - export anyway with just cookies?")) {
      return;
    }
    var payload = { cookies: document.cookie, origin: location.origin, requests: captured };
    var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    location.href = GRAB_URL + "#" + encoded;
  });
})();
