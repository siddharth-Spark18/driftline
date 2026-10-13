import type { Command } from "commander";
import { existsSync, readFileSync, statSync } from "node:fs";
import { renderDigest } from "../digest/terminal.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { CliError } from "../lib/errors.ts";
import { printSuccess } from "../lib/output.ts";
import { lastScanPath, readOwnPackageJson, resolveTargetRepo } from "../lib/paths.ts";
import type { WorklistItem } from "../scan/types.ts";
import { addReportOptions, resolveSaveChoice, saveReport } from "./report-output.ts";

export function registerDigestCommand(program: Command): void {
  const digest = program
    .command("digest")
    .description("Render the last scan's worklist as a terminal digest (email delivery lands in PER-13)");
  addReportOptions(digest)
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
        let ignored: number | undefined;
        let scannedAt: string | undefined;
        try {
          // `overflow` is absent in caches written before PER-12, `ignored` in those before the ignore list.
          ({ worklist, overflow, ignored, scannedAt } = JSON.parse(readFileSync(cachePath, "utf8")) as {
            worklist: WorklistItem[];
            overflow?: number;
            ignored?: number;
            scannedAt?: string;
          });
        } catch (err) {
          throw new CliError(`Cached scan results at ${cachePath} are corrupt: ${(err as Error).message}`);
        }

        // Asked after the cache is validated, so a missing scan fails before any prompt.
        const saveChoice = await resolveSaveChoice(globalOpts);
        if (saveChoice === "cancelled") return;

        printSuccess(worklist, renderDigest(worklist, { repoLabel: repoPath, overflow, ignored }), outputOpts, {
          overflow: overflow ?? 0,
        });
        saveReport(
          saveChoice,
          {
            scannedAt: scannedAt ?? statSync(cachePath).mtime.toISOString(),
            repo: repoPath,
            driftlineVersion: readOwnPackageJson().version,
            overflow: overflow ?? 0,
            worklist,
          },
          outputOpts,
        );
      }),
    );
}
