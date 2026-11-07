import { ImageTestRequest } from "@codeden/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/** `/api/images`: the image generation settings screen (§12.5). */
export function imageRoutes(s: AppServices) {
  return new Hono()
    .get("/engines", queryOf(z.object({ projectId: z.string().optional() })), async (c) =>
      c.json(await s.images.engines(c.req.valid("query").projectId)),
    )
    .post("/test", jsonBody(ImageTestRequest), async (c) => {
      const result = await s.images.test(c.req.valid("json"));
      // A test may change what is available (e.g. a key that now works).
      s.images.invalidate();
      return c.json(result);
    });
}
