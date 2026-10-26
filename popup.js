const api = globalThis.DevToolsPassLogic;
const $ = (id) => document.getElementById(id);

let currentTab = null;
let currentHost = null;
let hosts = [];
let busy = false;

init().catch((error) => {
  $("note").textContent = error && error.message ? error.message : String(error);
});

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;
  currentHost = tab ? api.hostFromUrl(tab.url || "") : null;
  const data = await browser.storage.local.get({ hosts: [], lastError: "" });
  hosts = sanitize(data.hosts);
  render(data.lastError || "");
}

function sanitize(list) {
  return (Array.isArray(list) ? list : []).filter((entry) => entry && api.isSafeHost(entry.host));
}

function exactEntry() {
  return hosts.find((entry) => entry.host === currentHost) || null;
}

function parentEntry() {
  return hosts.find((entry) => entry.host !== currentHost && api.hostMatches(entry, currentHost)) || null;
}

function render(message) {
  const exact = currentHost ? exactEntry() : null;
  const parent = currentHost ? parentEntry() : null;
  const covered = Boolean(exact || parent);
  const lockedByParent = Boolean(parent && !exact);

  $("host").textContent = currentHost || "Not a web page";
  $("toggle").setAttribute("aria-checked", exact ? "true" : "false");
  $("toggle").disabled = busy || !currentHost || lockedByParent;
  $("subs").checked = exact ? Boolean(exact.subdomains) : !api.isIpHost(currentHost || "");
  $("subs").disabled = busy || !currentHost || api.isIpHost(currentHost || "") || lockedByParent;
  $("badge").textContent = covered ? "on" : "off";
  $("badge").dataset.on = covered ? "1" : "0";

  const notes = [];
  if (lockedByParent) notes.push(`Covered by ${parent.host} including subdomains. Remove that host to turn this off.`);
  else if (currentHost) notes.push("Toggling reloads this tab.");
  if (message) notes.push(message);
  $("note").textContent = notes.join(" ");

  const list = $("list");
  list.replaceChildren();
  if (!hosts.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "None yet";
    list.append(empty);
    return;
  }
  for (const entry of hosts) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = entry.subdomains ? `${entry.host} + subdomains` : entry.host;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeHost(entry));
    item.append(name, remove);
    list.append(item);
  }
}

async function persist(reload) {
  busy = true;
  render("");
  try {
    await browser.storage.local.set({ hosts, lastError: "" });
    const result = await browser.runtime.sendMessage({ type: "sync" });
    const error = result && result.error ? result.error : "";
    busy = false;
    render(error);
    if (!error && reload && currentTab && currentTab.id != null) await browser.tabs.reload(currentTab.id);
  } catch (error) {
    busy = false;
    render(error && error.message ? error.message : String(error));
  }
}

$("toggle").addEventListener("click", async () => {
  if (!currentHost || busy || $("toggle").disabled) return;
  const turningOn = $("toggle").getAttribute("aria-checked") !== "true";
  const subdomains = $("subs").checked && !api.isIpHost(currentHost);
  busy = true;
  if (turningOn) {
    const granted = await browser.permissions.request({
      origins: api.originPatterns({ host: currentHost, subdomains }),
    });
    if (!granted) {
      busy = false;
      render("Permission denied.");
      return;
    }
    hosts = hosts.filter((entry) => entry.host !== currentHost);
    hosts.push({ host: currentHost, subdomains });
    hosts.sort((a, b) => a.host.localeCompare(b.host));
    await persist(true);
    return;
  }
  const previous = exactEntry();
  hosts = hosts.filter((entry) => entry.host !== currentHost);
  await persist(true);
  if (previous) await browser.permissions.remove({ origins: api.originPatterns(previous) });
});

$("subs").addEventListener("change", async () => {
  const exact = exactEntry();
  if (!exact || !currentHost || busy) return;
  const subdomains = $("subs").checked && !api.isIpHost(currentHost);
  busy = true;
  if (subdomains) {
    const granted = await browser.permissions.request({
      origins: api.originPatterns({ host: currentHost, subdomains: true }),
    });
    if (!granted) {
      busy = false;
      $("subs").checked = false;
      render("Permission denied.");
      return;
    }
  }
  hosts = hosts.map((entry) => (entry.host === currentHost ? { host: currentHost, subdomains } : entry));
  await persist(true);
  if (!subdomains) await browser.permissions.remove({ origins: [`*://*.${currentHost}/*`] });
});

async function removeHost(entry) {
  if (busy) return;
  hosts = hosts.filter((item) => item.host !== entry.host);
  const reload = Boolean(currentHost && api.hostMatches(entry, currentHost));
  await persist(reload);
  await browser.permissions.remove({ origins: api.originPatterns(entry) });
}
