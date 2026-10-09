import { ApiError, badRequest } from "./errors.js";

const MAX_JSON_BYTES = 16 * 1024;

// Reject state-changing requests sent from another website. Browsers always
// add an Origin header to cross-site POSTs; if it is present it must match
// this server. (Together with SameSite=Lax cookies this is our CSRF defence.)
export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin navigations / non-browser clients
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "CROSS_ORIGIN", "Cross-origin request rejected");
  }
  if (originHost !== request.headers.get("host")) {
    throw new ApiError(403, "CROSS_ORIGIN", "Cross-origin request rejected");
  }
}

// Read a JSON body with a content-type and size check, then validate it with a
// zod schema. Returns the parsed, typed data or throws a 4xx ApiError/ZodError.
export async function readJsonBody(request, schema) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest("Request body is not valid JSON");
  }
  return schema.parse(data); // throws ZodError -> 400 via handleApiError
}
