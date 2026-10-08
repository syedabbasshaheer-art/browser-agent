// node --test test/harness-free.test.mjs — card 3.5: the core stays harness-free.
//
// The promise of the adapter seam (3.4) is that the core (src/core, src/events, src/build) never
// knows which agent harness it runs under. This test walks every relative import from every core
// file, transitively, and fails if the walk ever reaches src/adapters, src/hooks or src/cli: the
// places that know about Claude Code (or any other harness). It fails at the first bad import,
// naming the chain, so a later change cannot quietly break the promise.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../plugin/src/", import.meta.url));
const CORE = ["core", "events", "build"];
const FORBIDDEN = ["adapters", "hooks", "cli"];
const rel = (f) => path.relative(SRC, f).split(path.sep).join("/");
const importsOf = (src) => [...src.matchAll(/(?:import|export)[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)].map((m) => m[1] || m[2]);

// Returns the first forbidden chain reachable from `start`, or null. `read` is injectable for the self-test.
export function badChain(start, read = (f) => fs.readFileSync(f, "utf8")) {
  const seen = new Set();
  const walk = (file, chain) => {
    if (seen.has(file)) return null; seen.add(file);
    const top = rel(file).split("/")[0];
    if (FORBIDDEN.includes(top)) return [...chain, rel(file)];
    let text; try { text = read(file); } catch { return null; }
    for (const spec of importsOf(text)) {
      const hit = walk(path.resolve(path.dirname(file), spec), [...chain, rel(file)]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(start, []);
}

const coreFiles = CORE.flatMap((d) => fs.readdirSync(path.join(SRC, d), { recursive: true })
  .filter((f) => String(f).endsWith(".mjs")).map((f) => path.join(SRC, d, String(f))));

test("harness-free: no core file reaches an adapter, a hook or the CLI", () => {
  assert.ok(coreFiles.length >= 9, `found only ${coreFiles.length} core files`);
  for (const f of coreFiles) {
    const chain = badChain(f);
    assert.equal(chain, null, `${rel(f)} reaches a harness-specific module: ${chain && chain.join(" -> ")}`);
  }
});
test("harness-free: the check itself catches a direct and an indirect import", () => {
  const fake = { [path.join(SRC, "core/a.mjs")]: `import { x } from "./b.mjs";`, [path.join(SRC, "core/b.mjs")]: `import { claude } from "../adapters/claude.mjs";` };
  const read = (f) => { if (f in fake) return fake[f]; throw new Error("none"); };
  assert.deepEqual(badChain(path.join(SRC, "core/a.mjs"), read), ["core/a.mjs", "core/b.mjs", "adapters/claude.mjs"]);
  assert.equal(badChain(path.join(SRC, "core/b.mjs"), () => `import fs from "node:fs";`), null);
});
