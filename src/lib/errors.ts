// Exit code conventions for the Driftline CLI. Other tickets (scan engine,
// digest, config) should throw these rather than calling process.exit directly,
// so exit codes and --json error shapes stay consistent everywhere.

export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  UsageError = 2,
  ConfigError = 3,
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly details?: Record<string, unknown>;

  constructor(message: string, exitCode: ExitCode = ExitCode.GeneralError, details?: Record<string, unknown>) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class UsageError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ExitCode.UsageError, details);
    this.name = "UsageError";
  }
}

export class ConfigError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ExitCode.ConfigError, details);
    this.name = "ConfigError";
  }
}

// Thrown by commands whose logic lands in a later ticket. Exits non-zero
// (rather than silently "succeeding") so scripts can't mistake a stub for
// a completed scan/digest.
export class NotImplementedError extends CliError {
  constructor(message: string) {
    super(message, ExitCode.GeneralError);
    this.name = "NotImplementedError";
  }
}
