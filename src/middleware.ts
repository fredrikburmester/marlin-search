import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import {
  EXPRESS_AUTH_TOKEN,
  SEARCH_AUTH_TOKEN,
  WEBHOOK_AUTH_TOKEN,
} from "./config";
import { logger } from "./logger";

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * Accept both `Authorization: <token>` and `Authorization: Bearer <token>`.
 * Cuts down on mysterious 403s when configuring a client.
 */
const presentedToken = (header: string | undefined): string =>
  header ? header.replace(BEARER_PREFIX, "").trim() : "";

/** Hash first so the comparison is fixed-width and we don't leak content or length. */
const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

const tokensMatch = (presented: string, expected: string): boolean =>
  timingSafeEqual(sha256(presented), sha256(expected));

type GuardOptions = {
  /**
   * What to do when no token is configured. `true` leaves the route open,
   * `false` (the default) disables it. Never compare two unset values: an
   * absent header and an absent token are both `undefined` and would match.
   */
  publicWhenUnset?: boolean;
};

export const requireToken = (
  variableName: string,
  expected: string | undefined,
  { publicWhenUnset = false }: GuardOptions = {}
): RequestHandler => {
  if (!expected) {
    if (publicWhenUnset) {
      return (_req, _res, next) => next();
    }

    logger.warn(
      `${variableName} is not set - the routes it guards are disabled and will return 503.`
    );
    return (_req, res) => {
      res.status(503).json({
        status: "error",
        message: `This endpoint is disabled because ${variableName} is not configured.`,
      });
    };
  }

  return (req, res, next) => {
    const presented = presentedToken(req.headers.authorization);
    if (presented && tokensMatch(presented, expected)) {
      next();
      return;
    }

    res.status(401).json({
      status: "error",
      message: "Unauthorized: missing or invalid token",
    });
  };
};

/** Guards the index management routes. */
export const authenticateToken = requireToken(
  "EXPRESS_AUTH_TOKEN",
  EXPRESS_AUTH_TOKEN
);

/** Guards /search. Open when SEARCH_AUTH_TOKEN is unset, preserving the old behaviour. */
export const authenticateSearch = requireToken(
  "SEARCH_AUTH_TOKEN",
  SEARCH_AUTH_TOKEN,
  { publicWhenUnset: true }
);

/** Guards the Jellyfin webhook receiver. */
export const authenticateWebhook = requireToken(
  "WEBHOOK_AUTH_TOKEN",
  WEBHOOK_AUTH_TOKEN
);
