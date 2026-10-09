import { getSessionMaxAgeSeconds } from "./jwt.js";

export const SESSION_COOKIE = "tm_session";

// httpOnly  -> page JavaScript cannot read the token (protects against XSS theft)
// sameSite  -> 'lax': the browser does not attach the cookie to cross-site
//              POST/fetch requests, which blocks most CSRF attacks, while
//              normal links into the site still keep you logged in
// secure    -> HTTPS only in production (browsers allow it on http://localhost)
// path '/'  -> sent to every route of the app
export function sessionCookieOptions(maxAgeSeconds = getSessionMaxAgeSeconds()) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// `response` is a NextResponse (anything with response.cookies.set).
export function setSessionCookie(response, token) {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

// Overwrite with an empty value that expires immediately (Max-Age=0), using
// the same name/path/flags so the browser replaces the original cookie.
export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
}
