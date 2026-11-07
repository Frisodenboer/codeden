/** HTTP status codes services may signal. */
export type ServiceStatus = 400 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 502 | 503;

/**
 * An expected failure with a machine-readable code. Routes turn it into
 * `{ error: { code, message } }` with `status`; anything else becomes a 500.
 */
export class ServiceError extends Error {
  constructor(
    readonly status: ServiceStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const badRequest = (message: string, code = "bad_request") =>
  new ServiceError(400, code, message);
export const notFound = (message: string, code = "not_found") =>
  new ServiceError(404, code, message);
export const conflict = (message: string, code = "conflict") =>
  new ServiceError(409, code, message);
export const forbidden = (message: string, code = "forbidden") =>
  new ServiceError(403, code, message);

/** Human-readable message of any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
