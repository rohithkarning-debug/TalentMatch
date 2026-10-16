import { z } from "zod";

// Query string of GET /api/recruiter/jobs/:jobId/matches
//   applicantsOnly=true|false  (default false: search every candidate)
//   limit=1..50                (default 10)
export const jobMatchesQuerySchema = z.strictObject({
  applicantsOnly: z.enum(["true", "false"], "applicantsOnly must be true or false")
    .transform((v) => v === "true")
    .default(false),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ---------------------------------------------------------------- jobs ----
// Same limits as the CHECK constraints in migrations 004 and 009. The
// database stays the final check; these give the user a clear message first.
export const JOB_STATUSES = ["draft", "open", "closed"];
export const WORK_MODES = ["onsite", "remote", "hybrid"];
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"];
export const MAX_JOB_SKILLS = 30;

const oneDecimal = (v) => Number.isInteger(Math.round(v * 1000) / 100);
// z.null() must come first: z.coerce.number() would turn null into 0
// (Number(null) === 0) and "no salary given" would be stored as ₹0.
const salary = z.union([z.null(), z.coerce.number().min(0, "Salary cannot be negative").max(9_999_999_999.99)]);

const jobSkillSchema = z.strictObject({
  skillId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  isRequired: z.boolean().default(true),
  minProficiency: z.coerce.number().int().min(1).max(5).default(3),
});

const jobFields = {
  title: z.string().trim().min(1, "Title is required").max(150, "Title must be at most 150 characters"),
  description: z.string().trim()
    .min(50, "Description must be at least 50 characters (it is used for semantic matching)")
    .max(10_000, "Description must be at most 10,000 characters"),
  location: z.string().trim().min(1, "Location is required").max(120),
  workMode: z.enum(WORK_MODES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  salaryMin: salary,
  salaryMax: salary,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as INR"),
  openings: z.coerce.number().int().min(1).max(500),
  minExperienceYears: z.coerce.number().min(0).max(40).refine(oneDecimal, "Use at most one decimal place"),
  closesAt: z.union([z.iso.date("Closing date must be YYYY-MM-DD"), z.null()]),
  status: z.enum(JOB_STATUSES),
  skills: z.array(jobSkillSchema).max(MAX_JOB_SKILLS, `At most ${MAX_JOB_SKILLS} skills`)
    .refine((list) => new Set(list.map((s) => s.skillId)).size === list.length, "Each skill can be listed only once"),
};

function checkSalaryRange(data, ctx) {
  if (data.salaryMin != null && data.salaryMax != null && data.salaryMax < data.salaryMin) {
    ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "Maximum salary must be at least the minimum salary" });
  }
}

export const jobCreateSchema = z.strictObject({
  ...jobFields,
  workMode: jobFields.workMode.default("onsite"),
  employmentType: jobFields.employmentType.default("full_time"),
  salaryMin: salary.default(null),
  salaryMax: salary.default(null),
  currency: jobFields.currency.default("INR"),
  openings: jobFields.openings.default(1),
  minExperienceYears: jobFields.minExperienceYears.default(0),
  closesAt: jobFields.closesAt.default(null),
  status: jobFields.status.default("draft"),
  skills: jobFields.skills.default([]),
}).superRefine(checkSalaryRange);

// PATCH: any subset of the fields. A salary range split over the stored row
// and the request (e.g. only salaryMax sent) is checked by the database's
// jobs_salary_range_check.
export const jobUpdateSchema = z.strictObject(
  Object.fromEntries(Object.entries(jobFields).map(([k, v]) => [k, v.optional()])),
).superRefine(checkSalaryRange)
  .refine((data) => Object.keys(data).length > 0, "Provide at least one field to update");

// Fields whose change alters the job's embedding text (title, description,
// required skills; see buildJobEmbeddingText in src/lib/vector-store.js).
export const EMBEDDED_JOB_FIELDS = ["title", "description", "skills"];

// --------------------------------------------------------- applications ----
export const APPLICATION_STATUSES = ["applied", "shortlisted", "interviewed", "offered", "rejected"];

// The allowed transitions are NOT checked here on purpose: the database
// trigger trg_applications_status_guard is the single source of truth.
export const applicationStatusSchema = z.strictObject({
  status: z.enum(APPLICATION_STATUSES, "Unknown application status"),
  note: z.union([z.string().trim().max(500, "Note must be at most 500 characters"), z.null()]).optional(),
});
