import { z } from "zod";

// Request schemas for interviews, offers and notifications. Shared by the
// API (server) and the forms (browser). The database repeats every rule
// (CHECK constraints and the triggers of migration 018), so a request that
// skips the API still cannot break them.

export const INTERVIEW_MODES = ["video", "phone", "onsite"];

// Offer dates are Indian calendar dates. The same rule as local_today() in
// the database, computed in JS: "YYYY-MM-DD" in Asia/Kolkata.
export function todayInIndia(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

// ISO 8601 with an explicit offset ("2026-10-20T10:00:00.000Z" or
// "+05:30"), so the server never guesses the time zone.
const futureDateTime = z.iso.datetime({ offset: true, error: "Date and time must be an ISO timestamp" })
  .refine((v) => new Date(v).getTime() > Date.now(), "Interview must be scheduled in the future");

const locationOrLink = z.union([z.string().trim().max(500, "At most 500 characters"), z.null()])
  .transform((v) => (v ? v : null));

// Video needs a meeting link, onsite needs an address; phone may leave it
// empty (DB: interviews_location_required_check).
function checkLocation(data, ctx) {
  if (data.mode === "phone") return;
  if (!data.locationOrLink) {
    ctx.addIssue({ code: "custom", path: ["locationOrLink"],
      message: data.mode === "video" ? "A meeting link is required for a video interview" : "A location is required for an onsite interview" });
  } else if (data.mode === "video" && !/^https?:\/\/\S+$/i.test(data.locationOrLink)) {
    ctx.addIssue({ code: "custom", path: ["locationOrLink"], message: "Meeting link must start with http:// or https://" });
  }
}

export const interviewScheduleSchema = z.strictObject({
  scheduledAt: futureDateTime,
  durationMinutes: z.coerce.number().int().min(15, "At least 15 minutes").max(480, "At most 8 hours").default(45),
  mode: z.enum(INTERVIEW_MODES, "Mode must be video, phone or onsite"),
  locationOrLink: locationOrLink.default(null),
}).superRefine(checkLocation);

// PATCH /api/recruiter/interviews/:id. One of three actions.
export const interviewUpdateSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("reschedule"),
    scheduledAt: futureDateTime,
    locationOrLink: locationOrLink.optional(),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    reason: z.union([z.string().trim().max(300, "At most 300 characters"), z.null()]).optional(),
  }),
  z.strictObject({
    action: z.literal("complete"),
    rating: z.coerce.number().int("Rating must be a whole number").min(1, "Rating must be 1 to 5").max(5, "Rating must be 1 to 5"),
    feedback: z.string().trim().min(1, "Feedback is required").max(2000, "At most 2000 characters"),
  }),
], { error: "action must be reschedule, cancel or complete" });

const isoDate = (label) => z.iso.date(`${label} must be YYYY-MM-DD`);

export const offerCreateSchema = z.strictObject({
  salaryOffered: z.coerce.number().positive("Salary must be greater than 0").max(9_999_999_999.99),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as INR").default("INR"),
  joiningDate: isoDate("Joining date").refine((d) => d > todayInIndia(), "Joining date must be after today"),
  expiresOn: isoDate("Expiry date").refine((d) => d >= todayInIndia(), "Expiry date cannot be in the past"),
}).superRefine((data, ctx) => {
  if (data.expiresOn > data.joiningDate) {
    ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "The offer must expire on or before the joining date" });
  }
});

// The candidate's answer; stored as offers.status 'accepted' / 'declined'.
export const offerResponseSchema = z.strictObject({
  decision: z.enum(["accept", "decline"], "decision must be accept or decline"),
});

export const notificationUpdateSchema = z.strictObject({
  isRead: z.literal(true, "Only isRead: true is supported"),
});

export const notificationListQuerySchema = z.strictObject({
  unreadOnly: z.enum(["true", "false"]).transform((v) => v === "true").default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const interviewListQuerySchema = z.strictObject({
  scope: z.enum(["upcoming", "past", "all"]).default("all"),
});
