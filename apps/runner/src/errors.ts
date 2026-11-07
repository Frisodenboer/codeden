/** Error with a machine-readable code, returned to the server as a failed result. */
export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}
