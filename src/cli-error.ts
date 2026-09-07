/**
 * Expected CLI failures with a Unix exit code.
 *
 * wrap() maps these to process.exit(code) instead of the generic exit 1 used
 * for unexpected throws. Exit 3 (partial batch) is usually set on
 * process.exitCode after the response has already been written.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export const EXIT_OK = 0;
export const EXIT_TRANSPORT = 1;
export const EXIT_USAGE = 2;
export const EXIT_PARTIAL = 3;

export function usageError(message: string): CliError {
  return new CliError(message, EXIT_USAGE);
}

export function transportError(message: string): CliError {
  return new CliError(message, EXIT_TRANSPORT);
}
