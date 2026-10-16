// ApiError and its shortcuts, with no framework imports, so library code that
// also runs under plain Node (scripts, node:test) can throw them.
// Route handlers keep importing them from ./errors.js, which re-exports these.

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
