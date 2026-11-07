import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { McpTokenClaims, Role } from "@codeden/contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { mcpTokens } from "../db/schema";

/** Prefix of CodeDen MCP tokens, so they are recognisable (and never confused with others). */
const PREFIX = "cdm_";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Per-session MCP bearer tokens (§8.3, §15). A token encodes nothing itself: it is a random
 * secret whose SHA-256 hash maps to the claims (role, project, session). Minting a token
 * revokes the session's previous ones; ending a session revokes them all. The install token
 * is never accepted here, and MCP tokens are never accepted by the HTTP API.
 */
export class McpTokenStore {
  constructor(private readonly db: Db) {}

  /** Issue a token for a session; returns the secret (store it only in the agent config). */
  mint(claims: { role: Role; sessionId: string; projectId: string | null }): string {
    const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(mcpTokens)
        .set({ revokedAt: now })
        .where(and(eq(mcpTokens.sessionId, claims.sessionId), isNull(mcpTokens.revokedAt)))
        .run();
      tx.insert(mcpTokens)
        .values({
          id: randomUUID(),
          tokenHash: hash(token),
          role: claims.role,
          sessionId: claims.sessionId,
          projectId: claims.projectId,
          createdAt: now,
          revokedAt: null,
        })
        .run();
    });
    return token;
  }

  /** Claims of a live token, or undefined for unknown and revoked tokens. */
  verify(token: string | undefined): McpTokenClaims | undefined {
    if (!token?.startsWith(PREFIX)) return undefined;
    const row = this.db
      .select()
      .from(mcpTokens)
      .where(and(eq(mcpTokens.tokenHash, hash(token)), isNull(mcpTokens.revokedAt)))
      .get();
    if (!row) return undefined;
    return {
      role: row.role as Role,
      sessionId: row.sessionId,
      projectId: row.projectId,
      jti: row.id,
    };
  }

  /** Revoke every token of a session (it ended). */
  revokeSession(sessionId: string): void {
    this.db
      .update(mcpTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(and(eq(mcpTokens.sessionId, sessionId), isNull(mcpTokens.revokedAt)))
      .run();
  }
}
