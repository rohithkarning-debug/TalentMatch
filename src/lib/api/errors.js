import { NextResponse } from "next/server";
import { z } from "zod";

// Every API error response has the same shape:
//   { "error": { "code": "SOME_CODE", "message": "Human readable", "details"?: {...} } }

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission to do this") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const badRequest = (message, details) =>
  new ApiError(400, "VALIDATION_ERROR", message, details);

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
    return jsonError(400, "INVALID_DATA", "The data violates a database rule");
  }
  console.error("[api] unexpected error:", err?.code || "", err?.message);
  return jsonError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}
