import { SignJWT, jwtVerify } from "jose";

// Session tokens are JWTs signed with HMAC-SHA256 (HS256) using a server-only
// secret. Anyone can READ a JWT payload (it is only base64), but nobody can
// CHANGE it without the secret, because the signature would no longer match.
// So the payload holds only what is needed: user id (sub) and role.

export const JWT_ISSUER = "talentmatch";
export const JWT_AUDIENCE = "talentmatch-web";
const ALGORITHM = "HS256";
const MIN_SECRET_LENGTH = 32;
const DEFAULT_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

// Validates configuration at runtime. Error messages never include the value.
function getSecretKey() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `AUTH_JWT_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. ` +
        "Set it in .env.local (see .env.example)."
    );
  }
  // The .env.example placeholder is public, so it must never be used as a key.
  if (secret.startsWith("replace_with")) {
    throw new Error("AUTH_JWT_SECRET is still the .env.example placeholder. Generate a random secret.");
  }
  return new TextEncoder().encode(secret);
}

export function getSessionMaxAgeSeconds() {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_AGE_SECONDS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 300 || value > 7 * 24 * 60 * 60) {
    throw new Error("AUTH_SESSION_MAX_AGE_SECONDS must be an integer between 300 and 604800.");
  }
  return value;
}

// user: { id, role }  ->  signed JWT string
export async function signSessionToken(user, { maxAgeSeconds = getSessionMaxAgeSeconds() } = {}) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setSubject(String(user.id))
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecretKey());
}

// Returns { userId, role, expiresAt } for a valid token, or null for anything
// else: bad signature, wrong algorithm (incl. "none"), expired, wrong
// issuer/audience, or malformed. Configuration errors (missing secret) DO
// throw, so a misconfigured server fails loudly instead of logging everyone out.
export async function verifySessionToken(token) {
  const key = getSecretKey();
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ["sub", "exp", "iat"],
    });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof payload.role !== "string") {
      return null;
    }
    return { userId, role: payload.role, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null; // jose throws on every invalid/expired token
  }
}
