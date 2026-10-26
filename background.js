const {
  hasDebugger,
  scrubCode,
  hostFromUrl,
  isSafeHost,
  hostMatches,
  originPatterns,
  scriptId,
} = globalThis.DevToolsPassLogic;

let hostEntries = [];
let queue = Promise.resolve();
let webRequestListening = false;

function syncAll() {
  const run = queue.then(doSync, doSync);
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function doSync() {
  const stored = await browser.storage.local.get({ hosts: [] });
  const seen = new Set();
  hostEntries = (Array.isArray(stored.hosts) ? stored.hosts : []).filter((entry) => {
    if (!entry || !isSafeHost(entry.host) || seen.has(entry.host)) return false;
    seen.add(entry.host);
    return originPatterns(entry).length > 0;
  });
  let error = "";
  try {
    await syncContentScripts();
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  try {
    syncWebRequest();
  } catch (err) {
    console.error("devtools-pass webRequest", err);
  }
  await browser.storage.local.set({ lastError: error });
  try {
    await refreshBadges();
  } catch (err) {}
  return { ok: !error, error };
}

async function syncContentScripts() {
  const existing = await browser.scripting.getRegisteredContentScripts();
  const ids = existing.filter((script) => script.id.startsWith("dtpass-")).map((script) => script.id);
  if (ids.length) await browser.scripting.unregisterContentScripts({ ids });
  if (!hostEntries.length) return;
  const boot = [];
  const main = [];
  for (const entry of hostEntries) {
    const matches = originPatterns(entry);
    const id = scriptId(entry.host);
    boot.push({
      id: `${id}-boot`,
      js: ["bootstrap.js"],
      matches,
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: true,
    });
    main.push({
      id,
      js: ["logic.js", "inject.js"],
      matches,
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      persistAcrossSessions: true,
    });
  }
  await browser.scripting.registerContentScripts(boot);
  try {
    await browser.scripting.registerContentScripts(main);
  } catch (error) {
    console.error("devtools-pass MAIN world registration failed", error);
  }
}

function syncWebRequest() {
  if (webRequestListening) {
    browser.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
    webRequestListening = false;
  }
  const urls = hostEntries.flatMap((entry) => originPatterns(entry));
  if (!urls.length) return;
  browser.webRequest.onHeadersReceived.addListener(onHeadersReceived, { urls, types: ["script"] }, [
    "blocking",
    "responseHeaders",
  ]);
  webRequestListening = true;
}

function onHeadersReceived(details) {
  try {
    if (!shouldRewrite(details)) return {};
    const filter = browser.webRequest.filterResponseData(details.requestId);
    rewriteFilter(filter);
  } catch (error) {
    console.error("devtools-pass rewrite failed", error);
  }
  return {};
}

function shouldRewrite(details) {
  let host = "";
  try {
    host = new URL(details.url).hostname;
  } catch (error) {
    return false;
  }
  if (!hostEntries.some((entry) => hostMatches(entry, host))) return false;
  const type = headerValue(details.responseHeaders, "content-type").toLowerCase();
  if (/wasm|octet-stream|image\/|audio\/|video\/|font\//.test(type)) return false;
  return true;
}

function headerValue(headers, name) {
  if (!headers) return "";
  const found = headers.find((header) => header.name.toLowerCase() === name);
  return found ? String(found.value || "") : "";
}

function rewriteFilter(filter) {
  const chunks = [];
  let total = 0;
  let pass = false;
  let wrote = false;
  const maxBytes = 12 * 1024 * 1024;

  function writeOnce(data) {
    if (wrote) return;
    wrote = true;
    filter.write(asBuffer(data));
  }

  filter.ondata = (event) => {
    if (pass) {
      filter.write(event.data);
      return;
    }
    total += event.data.byteLength;
    if (total > maxBytes) {
      pass = true;
      for (const chunk of chunks) filter.write(chunk);
      chunks.length = 0;
      filter.write(event.data);
      return;
    }
    chunks.push(event.data);
  };

  filter.onstop = () => {
    try {
      if (!pass) {
        const bytes = concatBytes(chunks);
        if (!looksBinary(bytes)) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (hasDebugger(text)) {
            const next = scrubCode(text);
            if (next !== text) {
              writeOnce(new TextEncoder().encode(next));
              filter.disconnect();
              return;
            }
          }
        }
        writeOnce(bytes);
      }
    } catch (error) {
      console.error("devtools-pass filter stop failed", error);
      if (!wrote && !pass) {
        try {
          writeOnce(concatBytes(chunks));
        } catch (nested) {}
      }
    }
    try {
      filter.disconnect();
    } catch (error) {}
  };

  filter.onerror = () => {
    console.error("devtools-pass filter error", filter.error);
    try {
      filter.disconnect();
    } catch (error) {}
  };
}

function concatBytes(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out;
}

function looksBinary(bytes) {
  const head = bytes.subarray(0, 512);
  for (let index = 0; index < head.length; index += 1) {
    if (head[index] === 0) return true;
  }
  return false;
}

function asBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function refreshBadges() {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => updateBadge(tab)));
}

function updateBadge(tab) {
  if (tab.id == null) return Promise.resolve();
  const host = hostFromUrl(tab.url || "");
  const on = Boolean(host && hostEntries.some((entry) => hostMatches(entry, host)));
  return browser.action.setBadgeText({ tabId: tab.id, text: on ? "ON" : "" });
}

browser.action.setBadgeBackgroundColor({ color: "#245c32" });
if (browser.action.setBadgeTextColor) browser.action.setBadgeTextColor({ color: "#eaffea" });

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "sync") return;
  return syncAll();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.hosts) syncAll();
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  browser.tabs.get(tabId).then(updateBadge).catch(() => {});
});

browser.tabs.onUpdated.addListener((tabId, _info, tab) => {
  updateBadge(tab || { id: tabId });
});

syncAll();
