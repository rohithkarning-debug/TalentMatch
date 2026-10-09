import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/request";
import { clearSessionCookie } from "@/lib/auth/cookie";
import { withErrorHandling } from "@/lib/auth/guards";

// POST /api/auth/logout — clears the session cookie. Works (200) whether or not
// the caller is logged in, so the UI can always call it safely.
// Note: JWTs are stateless; a copied token stays valid until it expires.
// See docs/authentication.md "Limitations".
export const POST = withErrorHandling(async (request) => {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  return clearSessionCookie(response);
});
