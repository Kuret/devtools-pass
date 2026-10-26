(function () {
  "use strict";

  function read(path) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", browser.runtime.getURL(path), false);
    xhr.send(null);
    if (xhr.status !== 0 && xhr.status !== 200) throw new Error(path + " " + xhr.status);
    return xhr.responseText;
  }

  function plant(code) {
    const parent = document.documentElement || document.head;
    if (!parent) return false;
    const el = document.createElement("script");
    el.textContent = code;
    parent.appendChild(el);
    el.remove();
    return true;
  }

  let code = null;
  function payload() {
    if (code == null) code = read("logic.js") + "\n" + read("inject.js");
    return code;
  }

  function install() {
    if (!document.documentElement && !document.head) return false;
    try {
      return plant(payload());
    } catch (error) {
      console.error("devtools-pass inject failed", error);
      return true;
    }
  }

  if (install()) return;

  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
})();
