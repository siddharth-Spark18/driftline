import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { renderDigest } from "../digest/terminal.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { CliError } from "../lib/errors.ts";
import { printSuccess } from "../lib/output.ts";
import { lastScanPath, resolveTargetRepo } from "../lib/paths.ts";
import type { WorklistItem } from "../scan/types.ts";

export function registerDigestCommand(program: Command): void {
  program
    .command("digest")
    .description("Render the last scan's worklist as a terminal digest (email delivery lands in PER-13)")
    .action(
      withErrorHandling(async (outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        const cachePath = lastScanPath(repoPath);

        if (!existsSync(cachePath)) {
          throw new CliError(`No scan results found for ${repoPath} — run \`driftline scan\` first.`);
        }

        let worklist: WorklistItem[];
        let overflow: number | undefined;
        try {
          // `overflow` is absent in caches written before PER-12.
          ({ worklist, overflow } = JSON.parse(readFileSync(cachePath, "utf8")) as {
            worklist: WorklistItem[];
            overflow?: number;
          });
        } catch (err) {
          throw new CliError(`Cached scan results at ${cachePath} are corrupt: ${(err as Error).message}`);
        }

        printSuccess(worklist, renderDigest(worklist, { repoLabel: repoPath, overflow }), outputOpts);
      }),
    );
}
