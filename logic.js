(function (root) {
  "use strict";

  function hasDebugger(code) {
    return /(?:^|[^\w$])debugger(?:$|[^\w$])/.test(String(code));
  }

  function isDebuggerAt(source, index) {
    if (source.slice(index, index + 8) !== "debugger") return false;
    const prev = index === 0 ? "" : source[index - 1];
    const next = source[index + 8] || "";
    if (prev && /[\w$]/.test(prev)) return false;
    if (next && /[\w$]/.test(next)) return false;
    return true;
  }

  function skipQuoted(source, index) {
    const quote = source[index];
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) return cursor + 1;
      cursor += 1;
    }
    return source.length;
  }

  function skipLineComment(source, index) {
    const end = source.indexOf("\n", index);
    return end === -1 ? source.length : end;
  }

  function skipBlockComment(source, index) {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  // Statement-level `debugger` becomes `void 0`. Quotes and comments stay.
  // Template literals are rewritten too: the page builds the trap with Function(`debugger`).
  function scrubCode(code) {
    const source = String(code);
    let out = "";
    let index = 0;
    while (index < source.length) {
      const char = source[index];
      if (char === "'" || char === '"') {
        const end = skipQuoted(source, index);
        out += source.slice(index, end);
        index = end;
        continue;
      }
      if (char === "/" && source[index + 1] === "/") {
        const end = skipLineComment(source, index);
        out += source.slice(index, end);
        index = end;
        continue;
      }
      if (char === "/" && source[index + 1] === "*") {
        const end = skipBlockComment(source, index);
        out += source.slice(index, end);
        index = end;
        continue;
      }
      if (isDebuggerAt(source, index)) {
        out += "void 0";
        index += 8;
        continue;
      }
      out += char;
      index += 1;
    }
    return out;
  }

  function scrubArgs(args) {
    const list = Array.from(args);
    if (!list.length) return list;
    const last = list[list.length - 1];
    if (typeof last === "string" && hasDebugger(last)) list[list.length - 1] = scrubCode(last);
    return list;
  }

  const INSPECT_WITH_SHIFT = new Set(["i", "j", "c", "k"]);

  function isInspectShortcut(event) {
    if (!event) return false;
    const key = String(event.key || "");
    if (key === "F12") return true;
    if (!(event.ctrlKey || event.metaKey)) return false;
    const lower = key.toLowerCase();
    if (lower === "u") return true;
    return Boolean(event.shiftKey && lower.length === 1 && INSPECT_WITH_SHIFT.has(lower));
  }

  function hostFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.hostname;
    } catch (error) {
      return null;
    }
  }

  function isIpHost(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  }

  function isSafeHost(host) {
    if (typeof host !== "string" || host.length === 0 || host.length > 253) return false;
    if (host.includes(":")) return /^[0-9a-f:]+$/i.test(host);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return host.split(".").every((part) => {
        const value = Number(part);
        return part === String(value) && value >= 0 && value <= 255;
      });
    }
    if (!/^[a-z0-9.-]+$/i.test(host)) return false;
    if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return false;
    return true;
  }

  function hostMatches(entry, host) {
    if (!entry || !isSafeHost(entry.host) || !isSafeHost(host)) return false;
    if (entry.host === host) return true;
    return Boolean(entry.subdomains) && host.endsWith("." + entry.host);
  }

  function originPatterns(entry) {
    if (!entry || !isSafeHost(entry.host)) return [];
    const host = entry.host.includes(":") ? `[${entry.host}]` : entry.host;
    const patterns = [`*://${host}/*`];
    if (entry.subdomains && !isIpHost(entry.host)) patterns.push(`*://*.${host}/*`);
    return patterns;
  }

  function scriptId(host) {
    let hash = 2166136261;
    for (let index = 0; index < host.length; index += 1) {
      hash ^= host.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return `dtpass-${(hash >>> 0).toString(36)}-${slug || "host"}`;
  }

  const api = {
    hasDebugger,
    scrubCode,
    scrubArgs,
    isInspectShortcut,
    hostFromUrl,
    isIpHost,
    isSafeHost,
    hostMatches,
    originPatterns,
    scriptId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  Object.defineProperty(root, "DevToolsPassLogic", {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
