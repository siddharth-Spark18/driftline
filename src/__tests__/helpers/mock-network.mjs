// Preloaded into the CLI child process (node --import) so `fetch` hits an in-memory
// fake of the npm registry, OSV and GitHub instead of the network. Driven by:
//   DRIFTLINE_TEST_FIXTURE  path to JSON { latest, times, osv }
//   DRIFTLINE_TEST_LOG      file every requested URL is appended to
import { appendFileSync, readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(process.env.DRIFTLINE_TEST_FIXTURE, "utf8"));
const log = process.env.DRIFTLINE_TEST_LOG;

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (log) appendFileSync(log, `${init?.method ?? "GET"} ${url}\n`);

  if (url.startsWith("https://registry.npmjs.org/")) {
    const path = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
    if (path.endsWith("/latest")) {
      const name = path.slice(0, -"/latest".length);
      const version = fixture.latest[name];
      return version ? json(200, { version, repository: fixture.repository?.[name] }) : json(404, {});
    }
    return json(200, { time: fixture.times?.[path] ?? {} });
  }
  if (url === "https://api.osv.dev/v1/query") {
    const body = JSON.parse(String(init.body));
    return json(200, { vulns: fixture.osv?.[body.package.name] ?? [] });
  }
  if (url.startsWith("https://api.github.com/")) return json(404, {});
  throw new Error(`Unexpected network request in test: ${url}`);
};
