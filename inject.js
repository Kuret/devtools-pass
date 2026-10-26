(function () {
  "use strict";

  const FLAG = Symbol.for("devtools-pass.applied");

  function sourceOf(toString, fn) {
    if (typeof toString !== "function" || typeof fn !== "function") return "";
    try {
      return toString.call(fn);
    } catch (error) {
      return "";
    }
  }

  function applyPatches(win, lib) {
    if (!win || !lib || win[FLAG]) return;
    Object.defineProperty(win, FLAG, { value: true });

    const nativeFunction = win.Function;
    const nativeToString = nativeFunction.prototype.toString;
    const nativeEval = win.eval;
    const nativeSetTimeout = win.setTimeout;
    const nativeSetInterval = win.setInterval;
    const masked = new WeakMap();
    const functionSource = sourceOf(nativeToString, nativeFunction);
    const toStringSource = sourceOf(nativeToString, nativeToString);
    const evalSource = sourceOf(nativeToString, nativeEval);
    const timeoutSource = sourceOf(nativeToString, nativeSetTimeout);
    const intervalSource = sourceOf(nativeToString, nativeSetInterval);

    function isProbe(fn) {
      if (typeof fn !== "function") return false;
      let src = "";
      try {
        src = nativeToString.call(fn);
      } catch (error) {
        return false;
      }
      const measuresDock = src.includes("outerWidth") && src.includes("outerHeight");
      if (measuresDock && (src.includes("debugger") || src.includes("devtools"))) return true;
      return src.includes("F12") && src.includes("View source");
    }

    function patchedFunction(...args) {
      return nativeFunction(...lib.scrubArgs(args));
    }
    patchedFunction.prototype = nativeFunction.prototype;
    try {
      Object.setPrototypeOf(patchedFunction, nativeFunction.prototype);
    } catch (error) {}
    try {
      Object.defineProperty(win, "Function", {
        value: patchedFunction,
        configurable: true,
        writable: true,
      });
    } catch (error) {
      try {
        win.Function = patchedFunction;
      } catch (assignError) {}
    }
    try {
      Object.defineProperty(nativeFunction.prototype, "constructor", {
        value: patchedFunction,
        configurable: true,
        writable: true,
      });
    } catch (error) {}

    if (typeof nativeEval === "function") {
      function patchedEval(code) {
        if (typeof code === "string" && lib.hasDebugger(code)) code = lib.scrubCode(code);
        return nativeEval(code);
      }
      Object.setPrototypeOf(patchedEval, nativeFunction.prototype);
      win.eval = patchedEval;
      masked.set(patchedEval, evalSource);
    }

    function patchTimer(name, native, source) {
      if (typeof native !== "function") return;
      function wrapped(fn, ...rest) {
        if (typeof fn === "string" && lib.hasDebugger(fn)) fn = lib.scrubCode(fn);
        if (isProbe(fn)) fn = function () {};
        return native.call(win, fn, ...rest);
      }
      Object.setPrototypeOf(wrapped, nativeFunction.prototype);
      win[name] = wrapped;
      if (source) masked.set(wrapped, source);
    }
    patchTimer("setTimeout", nativeSetTimeout, timeoutSource);
    patchTimer("setInterval", nativeSetInterval, intervalSource);
    shieldListeners(win, nativeToString, isProbe);
    if (win.EventTarget) shieldListeners(win.EventTarget.prototype, nativeToString, isProbe);

    try {
      clampOuter(win, "outerWidth", "innerWidth");
      clampOuter(win, "outerHeight", "innerHeight");
    } catch (error) {}

    win.addEventListener(
      "keydown",
      function (event) {
        if (!lib.isInspectShortcut(event)) return;
        event.stopImmediatePropagation();
      },
      true,
    );

    if (typeof nativeToString !== "function" || !functionSource) return;
    function patchedToString() {
      if (masked.has(this)) return masked.get(this);
      return nativeToString.call(this);
    }
    masked.set(patchedFunction, functionSource);
    if (toStringSource) masked.set(patchedToString, toStringSource);
    nativeFunction.prototype.toString = patchedToString;
  }

  function shieldListeners(owner, nativeToString, isProbe) {
    if (!owner || typeof owner.addEventListener !== "function" || owner.addEventListener.__devtoolsPass) return;
    const current = owner.addEventListener;
    function wrapped(type, listener, options) {
      if (typeof listener === "function" && isProbe(listener)) return;
      return current.call(this, type, listener, options);
    }
    wrapped.__devtoolsPass = true;
    try {
      wrapped.toString = function () {
        return nativeToString.call(current);
      };
    } catch (error) {}
    try {
      owner.addEventListener = wrapped;
    } catch (error) {}
  }

  function clampOuter(win, outerName, innerName) {
    const delta = 96;
    const limit = 160;
    const proto = win.Window && win.Window.prototype;
    const original = proto ? Object.getOwnPropertyDescriptor(proto, outerName) : null;
    const read = original && typeof original.get === "function" ? original.get : null;
    const getter = function () {
      let real;
      try {
        real = read ? read.call(this) : this[innerName] + delta;
      } catch (error) {
        real = this[innerName] + delta;
      }
      const inner = this[innerName];
      if (typeof real === "number" && typeof inner === "number" && real - inner > limit) return inner + delta;
      return real;
    };
    // Own property shadows a non-configurable prototype getter. Firefox's
    // outerWidth is typically non-configurable, which is why the dock check
    // was still firing.
    try {
      Object.defineProperty(win, outerName, { configurable: true, enumerable: true, get: getter });
      return;
    } catch (error) {}
    if (!read || !original || original.configurable === false) return;
    Object.defineProperty(proto, outerName, {
      configurable: true,
      enumerable: Boolean(original.enumerable),
      get: getter,
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { applyPatches };
    return;
  }

  const lib = globalThis.DevToolsPassLogic;
  try {
    delete globalThis.DevToolsPassLogic;
  } catch (error) {}
  if (!lib) return;
  applyPatches(globalThis, lib);
})();
