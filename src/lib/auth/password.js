import bcrypt from "bcryptjs";

// bcrypt work factor for new passwords: each +1 doubles the time an attacker
// needs per guess. 12 takes a few hundred ms with bcryptjs, fine for login.
// (Seeded demo accounts use cost 10; both verify the same way, because the
// cost is stored inside the hash itself.)
export const BCRYPT_COST = 12;

// bcrypt only uses the first 72 BYTES of a password; longer input is
// rejected by validation so two different long passwords cannot collide.
export const MAX_PASSWORD_BYTES = 72;

// A hash of a random value nobody knows. When a login email does not exist we
// still run one bcrypt comparison against this, so "unknown email" and
// "wrong password" take about the same time and cannot be told apart.
const DUMMY_HASH = "$2b$12$4/tzOX5AYnyHjgLHIKURCOsPdcAs8GMjMEvYjxP1T8KqRPNs5Dedu";

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_BYTES) {
    throw new RangeError(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  return bcrypt.hash(plain, BCRYPT_COST); // salt is generated and embedded automatically
}

// Returns true/false; never throws for a wrong password. Pass hash = null when
// the user was not found to keep timing uniform.
export async function verifyPassword(plain, hash) {
  if (typeof plain !== "string") return false;
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return hash ? ok : false;
}
