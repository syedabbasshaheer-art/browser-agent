// node --test test/qa/harness-free-strict.test.mjs
// PROPOSED (QA 2026-10-05). test/harness-free.test.mjs finds an import only when it has a `from`
// clause or is a dynamic import of a plain quoted string. Two ordinary forms get past it (both were
// planted in a scratch copy and the suite stayed green):
//     import "../adapters/index.mjs";                  a bare, side-effect import
//     const m = await import(`../cli/feed.mjs`);       a dynamic import written with backticks
// This is the same walk with a matcher that sees those too, plus a check for the harness's own
// environment variables, which are the other way a core file can come to know its harness.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../plugin/src/", import.meta.url));
const CORE = ["core", "events", "build"];
const FORBIDDEN = ["adapters", "hooks", "cli"];
const rel = (f) => path.relative(SRC, f).split(path.sep).join("/");

// Comments are dropped first, so a path mentioned in prose is not an import.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const Q = "[\"'`]";
const SPEC = `(\\.{1,2}\\/[^"'\`]+)`;
const PATTERNS = [
  new RegExp(`\\b(?:import|export)\\b[^"'\`;]*?\\bfrom\\s*${Q}${SPEC}${Q}`, "g"),   // import x from "./a"; export { y } from "./a"
  new RegExp(`\\bimport\\s*${Q}${SPEC}${Q}`, "g"),                                  // import "./a"
  new RegExp(`\\bimport\\s*\\(\\s*${Q}${SPEC}${Q}`, "g"),                            // import("./a"), import(\`./a\`)
  new RegExp(`\\brequire\\s*\\(\\s*${Q}${SPEC}${Q}`, "g"),                           // require("./a")
];
export const importsOf = (src) => { const s = code(src); return [...new Set(PATTERNS.flatMap((re) => [...s.matchAll(re)].map((m) => m[1])))]; };

export function badChain(start, read = (f) => fs.readFileSync(f, "utf8")) {
  const seen = new Set();
  const walk = (file, chain) => {
    if (seen.has(file)) return null; seen.add(file);
    if (FORBIDDEN.includes(rel(file).split("/")[0])) return [...chain, rel(file)];
    let text; try { text = read(file); } catch { return null; }
    for (const spec of importsOf(text)) { const hit = walk(path.resolve(path.dirname(file), spec), [...chain, rel(file)]); if (hit) return hit; }
    return null;
  };
  return walk(start, []);
}

const coreFiles = CORE.flatMap((d) => fs.readdirSync(path.join(SRC, d), { recursive: true })
  .filter((f) => String(f).endsWith(".mjs")).map((f) => path.join(SRC, d, String(f))));

test("harness-free (strict): the matcher sees every way one module can load another", () => {
  assert.deepEqual(importsOf(`import a from "./a.mjs";\nimport { b,\n  c } from '../b.mjs';\nexport * from "./c.mjs";`), ["./a.mjs", "../b.mjs", "./c.mjs"]);
  assert.deepEqual(importsOf(`import "./side.mjs";`), ["./side.mjs"]);
  assert.deepEqual(importsOf("const m = await import(`../cli/feed.mjs`);"), ["../cli/feed.mjs"]);
  assert.deepEqual(importsOf(`const m = await import( "./d.mjs" ); const r = require('./e.cjs');`), ["./d.mjs", "./e.cjs"]);
  assert.deepEqual(importsOf(`// import "../adapters/claude.mjs";\n/* import x from "../cli/x.mjs" */\nimport fs from "node:fs";`), [], "comments and built-ins are not imports");
  assert.deepEqual(importsOf(`const url = "https://example.com/a"; // see ./notes.md`), []);
});

test("harness-free (strict): each form is caught when it leads to an adapter, a hook or the CLI", () => {
  const A = path.join(SRC, "core/a.mjs"), B = path.join(SRC, "core/b.mjs");
  const via = (line) => badChain(A, (f) => { if (f === A) return `import { x } from "./b.mjs";`; if (f === B) return line; throw new Error("none"); });
  assert.deepEqual(via(`import { claude } from "../adapters/claude.mjs";`), ["core/a.mjs", "core/b.mjs", "adapters/claude.mjs"]);
  assert.deepEqual(via(`import "../adapters/index.mjs";`), ["core/a.mjs", "core/b.mjs", "adapters/index.mjs"]);
  assert.deepEqual(via("export const lazy = () => import(`../cli/feed.mjs`);"), ["core/a.mjs", "core/b.mjs", "cli/feed.mjs"]);
  assert.deepEqual(via(`export { guard } from '../hooks/lib.mjs';`), ["core/a.mjs", "core/b.mjs", "hooks/lib.mjs"]);
  assert.equal(via(`import fs from "node:fs"; // not ../adapters/claude.mjs`), null);
});

test("harness-free (strict): no core file reaches an adapter, a hook or the CLI, by any of those forms", () => {
  assert.ok(coreFiles.length >= 9, `found only ${coreFiles.length} core files`);
  let edges = 0;
  for (const f of coreFiles) {
    edges += importsOf(fs.readFileSync(f, "utf8")).length;
    const chain = badChain(f);
    assert.equal(chain, null, `${rel(f)} reaches a harness-specific module: ${chain && chain.join(" -> ")}`);
  }
  assert.ok(edges >= 10, `the walk followed only ${edges} imports: the matcher has gone blind`);
});

test("harness-free (strict): the only harness variable the core reads is the project folder, in config.mjs", () => {
  const uses = [];
  for (const f of coreFiles) for (const m of code(fs.readFileSync(f, "utf8")).matchAll(/\b(CLAUDE_[A-Z_]+|CODEX_[A-Z_]+|CURSOR_[A-Z_]+)\b/g)) uses.push(rel(f) + ":" + m[1]);
  assert.deepEqual([...new Set(uses)], ["build/config.mjs:CLAUDE_PROJECT_DIR"]);
});
