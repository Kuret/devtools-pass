const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scrubCode,
  hasDebugger,
  scrubArgs,
  isInspectShortcut,
  hostFromUrl,
  isSafeHost,
  isIpHost,
  hostMatches,
  originPatterns,
  scriptId,
} = require("../logic.js");

test("replaces a bare debugger statement", () => {
  assert.equal(scrubCode("debugger"), "void 0");
  assert.equal(scrubCode("function f(){ debugger; }"), "function f(){ void 0; }");
});

test("leaves debugger inside strings and comments, rewrites template traps", () => {
  assert.equal(scrubCode("'debugger'"), "'debugger'");
  assert.equal(scrubCode('"debugger"'), '"debugger"');
  assert.equal(scrubCode('Function("debugger")'), 'Function("debugger")');
  assert.equal(scrubCode("`debugger`"), "`void 0`");
  assert.equal(scrubCode("Function(`debugger`)()"), "Function(`void 0`)()");
  assert.equal(scrubCode('`say "debugger"`'), '`say "debugger"`');
  assert.equal(scrubCode("// debugger\nreturn 1"), "// debugger\nreturn 1");
  assert.equal(scrubCode("/* debugger */ return 1"), "/* debugger */ return 1");
});

test("does not touch identifiers that merely start with debugger", () => {
  assert.equal(scrubCode("const debuggerMode = 1"), "const debuggerMode = 1");
  assert.equal(hasDebugger("const debuggerMode = 1"), false);
  assert.equal(hasDebugger("debugger"), true);
});

test("scrubs only the Function body argument", () => {
  assert.deepEqual(scrubArgs(["a", "return a + 1"]), ["a", "return a + 1"]);
  assert.deepEqual(scrubArgs(["debugger"]), ["void 0"]);
  assert.deepEqual(scrubArgs(['return "debugger"']), ['return "debugger"']);
});

test("recognizes inspect shortcuts and ignores normal typing", () => {
  assert.equal(isInspectShortcut({ key: "F12" }), true);
  assert.equal(isInspectShortcut({ key: "I", ctrlKey: true, shiftKey: true }), true);
  assert.equal(isInspectShortcut({ key: "k", metaKey: true, shiftKey: true }), true);
  assert.equal(isInspectShortcut({ key: "u", ctrlKey: true, shiftKey: false }), true);
  assert.equal(isInspectShortcut({ key: "i", ctrlKey: true, shiftKey: false }), false);
  assert.equal(isInspectShortcut({ key: "a", ctrlKey: true, shiftKey: true }), false);
  assert.equal(isInspectShortcut({ key: "F5" }), false);
});

test("host matching covers the exact host and opted-in subdomains only", () => {
  const entry = { host: "zenkaii.pages.dev", subdomains: true };
  assert.equal(hostMatches(entry, "zenkaii.pages.dev"), true);
  assert.equal(hostMatches(entry, "1e467fe5.zenkaii.pages.dev"), true);
  assert.equal(hostMatches(entry, "evilzenkaii.pages.dev"), false);
  assert.equal(hostMatches({ host: "zenkaii.pages.dev", subdomains: false }, "1e467fe5.zenkaii.pages.dev"), false);
});

test("origin patterns stay inside the saved host", () => {
  assert.deepEqual(originPatterns({ host: "zenkaii.pages.dev", subdomains: true }), [
    "*://zenkaii.pages.dev/*",
    "*://*.zenkaii.pages.dev/*",
  ]);
  assert.deepEqual(originPatterns({ host: "127.0.0.1", subdomains: true }), ["*://127.0.0.1/*"]);
  assert.deepEqual(originPatterns({ host: "*.evil.com", subdomains: true }), []);
});

test("rejects hosts that could widen a match pattern", () => {
  for (const host of ["*", "*.evil.com", "evil.com/", "a..b.com", "", "https://evil.com"]) {
    assert.equal(isSafeHost(host), false, host);
  }
  assert.equal(isSafeHost("zenkaii.pages.dev"), true);
  assert.equal(isSafeHost("127.0.0.1"), true);
  assert.equal(isIpHost("127.0.0.1"), true);
  assert.equal(isIpHost("zenkaii.pages.dev"), false);
});

test("reads a hostname only from http(s) urls", () => {
  assert.equal(hostFromUrl("https://zenkaii.pages.dev/busted"), "zenkaii.pages.dev");
  assert.equal(hostFromUrl("about:debugging"), null);
  assert.equal(hostFromUrl("moz-extension://abc/popup.html"), null);
});

test("script ids are unique and match-pattern safe", () => {
  const a = scriptId("a.b.com");
  const b = scriptId("a-b.com");
  assert.notEqual(a, b);
  assert.match(a, /^dtpass-[a-z0-9]+-[a-z0-9-]+$/);
  assert.match(b, /^dtpass-[a-z0-9]+-[a-z0-9-]+$/);
});
