import type { Command } from "commander";
import { withErrorHandling } from "../lib/command-handler.ts";
import { NotImplementedError } from "../lib/errors.ts";

export function registerDigestCommand(program: Command): void {
  program
    .command("digest")
    .description("Render the last scan's worklist as a weekly digest (terminal or email)")
    .action(
      withErrorHandling(async () => {
        throw new NotImplementedError(
          "digest is not yet implemented — this is the CLI scaffold (PER-8). " +
            "Terminal output (PER-11) and email delivery (PER-13) land in follow-up tickets.",
        );
      }),
    );
}
