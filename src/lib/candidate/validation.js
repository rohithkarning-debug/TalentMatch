import { z } from "zod";

const optionalText = (max, label) => z.union([
  z.string().trim().max(max, `${label} must be at most ${max} characters`),
  z.null(),
]).optional();

export const candidateProfileSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.union([z.string().trim().regex(/^\+?[0-9][0-9 -]{6,18}$/), z.literal(""), z.null()]).optional(),
  location: optionalText(120, "Location"),
  headline: optionalText(150, "Headline"),
  yearsExperience: z.coerce.number().min(0).max(60).refine((v) => Number.isInteger(v * 10), "Use at most one decimal place").optional(),
  highestEducation: optionalText(120, "Highest education"),
}).refine((data) => Object.keys(data).length > 0, "Provide at least one field to update");

export const candidateSkillSchema = z.strictObject({
  skillId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  proficiency: z.coerce.number().int().min(1).max(5),
  yearsUsed: z.coerce.number().min(0).max(60).refine((v) => Number.isInteger(v * 10), "Use at most one decimal place"),
});

// PATCH /api/candidate/resumes/:id — the only change allowed is "make this my primary resume".
export const resumeUpdateSchema = z.strictObject({
  isPrimary: z.literal(true, "isPrimary must be true"),
});
