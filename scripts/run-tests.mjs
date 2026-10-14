// Runs every src/**/*.test.ts through the Node test runner. `node --test` only
// expands glob patterns itself from Node 21/22 on, and driftline supports
// Node >= 18, so the file list is built here instead of in the npm script.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTests(path));
    else if (entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

const files = findTests("src").sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
