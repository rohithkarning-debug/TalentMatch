import { z } from "zod";

// Shared by the API (server) and the login/register forms (browser), so both
// apply exactly the same rules. The database adds its own CHECK constraints
// (email format, bcrypt hash format, non-blank name) as a final safety net.

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(255, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

const newPassword = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .refine((s) => utf8Bytes(s) <= 72, "Password must be at most 72 bytes")
  .refine((s) => /[A-Za-z]/.test(s) && /[0-9]/.test(s), "Password must contain a letter and a number");

// strictObject: any extra field, e.g. "role": "admin", is REJECTED with 400.
// Public registration can therefore only ever create a candidate.
export const registerSchema = z.strictObject({
  fullName: z
    .string({ error: "Full name is required" })
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(120, "Full name is too long"),
  email,
  password: newPassword,
});

export const loginSchema = z.strictObject({
  email,
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required")
    .refine((s) => utf8Bytes(s) <= 72, "Password must be at most 72 bytes"),
});

// Route parameter like /api/.../users/[id]
export const idParamSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
