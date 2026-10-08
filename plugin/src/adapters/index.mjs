// index.mjs - pick the adapter for this project: config "harness" (or COCKPIT_HARNESS), default "claude".
import { checkAdapter } from "./contract.mjs";
import { claude } from "./claude.mjs";
import { local } from "./local.mjs";

export const ADAPTERS = { claude, local };

export function adapterFor(name) {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`no adapter "${name}"; known: ${Object.keys(ADAPTERS).join(", ")}`);
  const missing = checkAdapter(a);
  if (missing.length) throw new Error(`adapter "${name}" is missing ${missing.join(", ")}`);
  return a;
}
