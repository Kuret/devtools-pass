const test = require("node:test");
const assert = require("node:assert/strict");
const logic = require("../logic.js");
const { applyPatches } = require("../inject.js");

const realToString = Function.prototype.toString;
function nativeToString() {
  if (this && this.__native) return `function ${this.__native}() { [native code] }`;
  if (this && this._src) return this._src;
  return realToString.call(this);
}

function makeWindow({ outerWidth = 1400, outerHeight = 1200 } = {}) {
  function NativeFunction(...args) {
    const fn = function patchedBody() {};
    fn.body = args[args.length - 1];
    fn._src = `function anonymous() { ${fn.body} }`;
    return fn;
  }
  NativeFunction.__native = "Function";
  NativeFunction.prototype.toString = nativeToString;
  NativeFunction.prototype.constructor = NativeFunction;

  const proto = {};
  Object.defineProperty(proto, "outerWidth", {
    configurable: true,
    enumerable: true,
    get() {
      return outerWidth;
    },
  });
  Object.defineProperty(proto, "outerHeight", {
    configurable: true,
    enumerable: true,
    get() {
      return outerHeight;
    },
  });

  const win = {
    Function: NativeFunction,
    eval(code) {
      return code;
    },
    setTimeout(fn, delay) {
      return { fn, delay, kind: "timeout" };
    },
    setInterval(fn, delay) {
      return { fn, delay, kind: "interval" };
    },
    innerWidth: 1000,
    innerHeight: 800,
    Window: { prototype: proto },
    listeners: [],
    addEventListener(type, fn, capture) {
      this.listeners.push({ type, fn, capture });
    },
  };
  win.eval.__native = "eval";
  win.setTimeout.__native = "setTimeout";
  win.setInterval.__native = "setInterval";
  Object.setPrototypeOf(win, proto);
  return win;
}

test("requiring inject does not patch the node realm", () => {
  assert.equal(Function.prototype.constructor, Function);
});

test("Function('debugger') loses the debugger statement", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  assert.equal(win.Function("debugger").body, "void 0");
  assert.equal(win.Function("return 1 + 1").body, "return 1 + 1");
  assert.equal(win.Function.prototype.constructor("debugger").body, "void 0");
});

test("eval and timer strings are scrubbed, function timers are not", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  assert.equal(win.eval("debugger"), "void 0");
  assert.equal(win.eval("return 1"), "return 1");
  assert.equal(win.setTimeout("debugger", 10).fn, "void 0");
  const fn = function tick() {};
  assert.equal(win.setInterval(fn, 10).fn, fn);
});

test("patched constructors still report native source", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  assert.equal(win.Function.toString(), "function Function() { [native code] }");
  assert.equal(win.setTimeout.toString(), "function setTimeout() { [native code] }");
  const foo = function foo() {
    return 1;
  };
  foo._src = "function foo() { return 1; }";
  Object.setPrototypeOf(foo, Object.getPrototypeOf(win.Function));
  assert.equal(foo.toString(), "function foo() { return 1; }");
});

test("docked devtools gap is clamped, a normal window is not", () => {
  const docked = makeWindow({ outerWidth: 1400, outerHeight: 1200 });
  applyPatches(docked, logic);
  assert.equal(docked.outerWidth, 1096);
  assert.equal(docked.outerHeight, 896);
  assert.equal(docked.outerWidth - docked.innerWidth > 175, false);
  assert.equal(docked.outerHeight - docked.innerHeight > 175, false);

  const normal = makeWindow({ outerWidth: 1080, outerHeight: 860 });
  applyPatches(normal, logic);
  assert.equal(normal.outerWidth, 1080);
  assert.equal(normal.outerHeight, 860);
});

test("devtools probe callbacks are not scheduled", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  let ran = false;
  function probe() {
    ran = true;
    return window.outerWidth + window.outerHeight + Function("debugger") + "devtools";
  }
  function onKey(event) {
    if (event.key === "F12") return "View source";
  }
  function innocent() {
    ran = true;
    return "outerWidth";
  }
  const timer = win.setInterval(probe, 900);
  timer.fn();
  assert.equal(ran, false);
  win.setInterval(innocent, 900).fn();
  assert.equal(ran, true);
  ran = false;
  win.addEventListener("resize", probe);
  win.addEventListener("keydown", onKey);
  assert.equal(win.listeners.some((listener) => listener.type === "resize"), false);
  assert.equal(win.listeners.some((listener) => String(listener.fn).includes("View source")), false);
});

test("outer size is clamped even if the prototype getter is frozen", () => {
  const win = makeWindow({ outerWidth: 1400, outerHeight: 1200 });
  const proto = win.Window.prototype;
  for (const name of ["outerWidth", "outerHeight"]) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { ...desc, configurable: false });
  }
  applyPatches(win, logic);
  assert.equal(win.outerWidth - win.innerWidth > 175, false);
  assert.equal(win.outerHeight - win.innerHeight > 175, false);
});

test("inspect shortcuts are swallowed before page listeners", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  const page = { saw: false };
  win.addEventListener("keydown", () => {
    page.saw = true;
  }, true);
  const blocker = win.listeners[0].fn;

  const inspect = { key: "F12", stopImmediatePropagation() { this.stopped = true; } };
  blocker(inspect);
  assert.equal(inspect.stopped, true);

  const typed = { key: "a", ctrlKey: false, metaKey: false, shiftKey: false, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
  blocker(typed);
  assert.equal(typed.stopped, false);
});

test("applyPatches runs once", () => {
  const win = makeWindow();
  applyPatches(win, logic);
  const first = win.Function;
  applyPatches(win, logic);
  assert.equal(win.Function, first);
});
