import { CliError, ExitCode } from "./errors.ts";

export interface OutputOptions {
  json: boolean;
}

export function printSuccess(data: unknown, message: string, opts: OutputOptions): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } else {
    console.log(message);
  }
}

/**
 * Prints an error in the shape matching --json/human conventions and returns
 * the exit code the caller should set via `process.exitCode`.
 */
export function printError(err: unknown, opts: OutputOptions): ExitCode {
  const isCliError = err instanceof CliError;
  const message = err instanceof Error ? err.message : String(err);
  const exitCode = isCliError ? err.exitCode : ExitCode.GeneralError;

  if (opts.json) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: {
          message,
          code: ExitCode[exitCode],
          ...(isCliError && err.details ? { details: err.details } : {}),
        },
      })}\n`,
    );
  } else {
    console.error(`Error: ${message}`);
  }

  return exitCode;
}
