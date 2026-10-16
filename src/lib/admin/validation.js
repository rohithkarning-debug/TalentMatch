import { z } from "zod";
import { email, newPassword } from "../validation/auth.js";

// Request bodies of the admin API. Same limits as the CHECK constraints in
// migration 002; the database stays the final check.

// "" from an empty form field means "not given" and is stored as NULL.
const optionalText = (max, label) => z.union([
  z.null(),
  z.string().trim().max(max, `${label} must be at most ${max} characters`).transform((v) => v || null),
]);

const website = z.union([
  z.null(),
  z.string().trim().max(255, "Website is too long").transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\/\S+$/.test(v), "Website must start with http:// or https://"),
]);

const phone = z.union([
  z.null(),
  z.string().trim().transform((v) => v || null)
    .refine((v) => v === null || /^\+?[0-9][0-9 -]{6,18}$/.test(v), "Phone must be 7 to 19 digits, spaces or dashes"),
]);

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const companyFields = {
  name: z.string().trim().min(1, "Company name is required").max(150, "Company name must be at most 150 characters"),
  industry: optionalText(120, "Industry"),
  location: optionalText(120, "Location"),
  website,
  description: optionalText(5000, "Description"),
};

// Optional columns default to NULL when creating.
const withNullDefaults = (fields) => Object.fromEntries(Object.entries(fields)
  .map(([k, v]) => [k, v instanceof z.ZodUnion ? v.default(null) : v]));

export const companyCreateSchema = z.strictObject(withNullDefaults(companyFields));
// PATCH: any subset, but at least one field.
export const companyUpdateSchema = z.strictObject(
  Object.fromEntries(Object.entries(companyFields).map(([k, v]) => [k, v.optional()]))
).refine((d) => Object.keys(d).length > 0, "Send at least one field to change");

// Recruiter accounts are created by an admin only. The role is never taken
// from the request: the route always inserts role = 'recruiter'.
export const recruiterCreateSchema = z.strictObject({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(120, "Full name is too long"),
  email,
  password: newPassword,
  companyId: id,
  designation: optionalText(80, "Designation").default(null),
  phone: phone.default(null),
});

export const recruiterUpdateSchema = z.strictObject({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(120).optional(),
  companyId: id.optional(),
  designation: optionalText(80, "Designation").optional(),
  phone: phone.optional(),
  isActive: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, "Send at least one field to change");
