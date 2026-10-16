import { NextResponse } from "next/server";
import { z } from "zod";

// Every API error response has the same shape:
//   { "error": { "code": "SOME_CODE", "message": "Human readable", "details"?: {...} } }

// ApiError and the helpers live in api-error.js (no framework imports, so
// library code tested under plain Node can use them); re-exported here.
import { ApiError } from "./api-error.js";
export { ApiError, badRequest, forbidden, notFound, unauthorized } from "./api-error.js";

export function jsonError(status, code, message, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Converts anything thrown inside a route handler into a safe JSON response.
// Unexpected errors are logged on the server only; the client never sees
// stack traces, SQL, or configuration details.
export function handleApiError(err) {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof z.ZodError) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid input", z.flattenError(err));
  }
  // PostgreSQL integrity errors that slipped past API validation
  if (err?.code === "23505") {
    return jsonError(409, "CONFLICT", "This record already exists");
  }
  if (err?.code === "23503" || err?.code === "23514" || err?.code === "22P02") {
    // The constraint name (e.g. jobs_closes_after_posted_check) is part of our
    // own schema, not a secret, and tells the user which rule was broken.
    return jsonError(400, "INVALID_DATA", "The data violates a database rule",
      err.constraint ? { constraint: err.constraint } : undefined);
  }
  console.error("[api] unexpected error:", err?.code || "", err?.message);
  return jsonError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}
