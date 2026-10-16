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
