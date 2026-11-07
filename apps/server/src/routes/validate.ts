import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { z } from "zod";
import { ServiceError } from "../services/errors";

/** Validation failures become `400 { error: { code: "bad_request", message } }`. */
function onInvalid(result: { success: boolean; error?: unknown }, c: Context) {
  if (!result.success) {
    const message =
      result.error instanceof z.ZodError ? z.prettifyError(result.error) : "Invalid request";
    return c.json({ error: { code: "bad_request", message } }, 400);
  }
}

/** Validate the JSON body with a contracts schema (typed for the Hono RPC client). */
export const jsonBody = <T extends z.ZodType>(schema: T) => zValidator("json", schema, onInvalid);

/** Validate the query string with a contracts schema. */
export const queryOf = <T extends z.ZodType>(schema: T) => zValidator("query", schema, onInvalid);

/** Map thrown errors to JSON responses; `ServiceError` keeps its status and code. */
export function errorResponse(error: unknown, c: Context, log?: (m: string) => void) {
  if (error instanceof ServiceError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  log?.(`api error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
}
