// Unit tests for the Stage 7 request schemas (interviews, offers,
// notifications). The database enforces the same rules again; those are
// tested in tests/integration/pipeline.test.js.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  interviewScheduleSchema, interviewUpdateSchema, offerCreateSchema, offerResponseSchema,
  notificationUpdateSchema, notificationListQuerySchema, todayInIndia,
} = await import("../../src/lib/validation/pipeline.js");

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fails = (schema, input) => assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));

describe("todayInIndia", () => {
  it("uses the Asia/Kolkata date, not UTC", () => {
    // 20:00 UTC on 15 Oct is 01:30 IST on 16 Oct.
    assert.equal(todayInIndia(new Date("2026-10-15T20:00:00Z")), "2026-10-16");
    assert.equal(todayInIndia(new Date("2026-10-15T18:00:00Z")), "2026-10-15");
  });
});

describe("interviewScheduleSchema", () => {
  const ok = { scheduledAt: inHours(24), mode: "video", locationOrLink: "https://meet.example/abc" };

  it("accepts a future video interview and fills defaults", () => {
    const parsed = interviewScheduleSchema.parse(ok);
    assert.equal(parsed.durationMinutes, 45);
    assert.equal(parsed.mode, "video");
  });

  it("phone interviews may omit the location; empty text becomes null", () => {
    assert.equal(interviewScheduleSchema.parse({ scheduledAt: inHours(2), mode: "phone" }).locationOrLink, null);
    assert.equal(interviewScheduleSchema.parse({ scheduledAt: inHours(2), mode: "phone", locationOrLink: "  " }).locationOrLink, null);
  });

  it("rejects a time in the past", () => {
    const result = interviewScheduleSchema.safeParse({ ...ok, scheduledAt: inHours(-1) });
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error.issues), /in the future/);
  });

  it("rejects missing location/link, bad link, bad mode, bad duration, no offset, extra fields", () => {
    fails(interviewScheduleSchema, { ...ok, locationOrLink: null });
    fails(interviewScheduleSchema, { ...ok, mode: "onsite", locationOrLink: "" });
    fails(interviewScheduleSchema, { ...ok, locationOrLink: "meet.example/abc" });
    fails(interviewScheduleSchema, { ...ok, mode: "zoom" });
    fails(interviewScheduleSchema, { ...ok, durationMinutes: 10 });
    fails(interviewScheduleSchema, { ...ok, durationMinutes: 481 });
    fails(interviewScheduleSchema, { ...ok, scheduledAt: "2030-01-01T10:00:00" });
    fails(interviewScheduleSchema, { ...ok, applicationStatus: "interviewed" });
  });
});

describe("interviewUpdateSchema", () => {
  it("accepts the three actions", () => {
    assert.equal(interviewUpdateSchema.parse({ action: "reschedule", scheduledAt: inHours(5) }).action, "reschedule");
    assert.equal(interviewUpdateSchema.parse({ action: "cancel" }).action, "cancel");
    assert.deepEqual(interviewUpdateSchema.parse({ action: "complete", rating: "4", feedback: " good " }),
      { action: "complete", rating: 4, feedback: "good" });
  });

  it("rejects rating outside 1-5, fractional rating, missing feedback, past reschedule, unknown action", () => {
    for (const rating of [0, 6, -1, 4.5, "five"]) fails(interviewUpdateSchema, { action: "complete", rating, feedback: "x" });
    fails(interviewUpdateSchema, { action: "complete", rating: 3, feedback: "   " });
    fails(interviewUpdateSchema, { action: "reschedule", scheduledAt: inHours(-2) });
    fails(interviewUpdateSchema, { action: "delete" });
    fails(interviewUpdateSchema, { action: "cancel", rating: 3 });
  });
});

describe("offerCreateSchema", () => {
  const today = todayInIndia();
  const ok = { salaryOffered: "2400000", joiningDate: addDays(today, 30), expiresOn: addDays(today, 7) };

  it("accepts a valid offer, coerces the salary and defaults the currency", () => {
    const parsed = offerCreateSchema.parse(ok);
    assert.equal(parsed.salaryOffered, 2_400_000);
    assert.equal(parsed.currency, "INR");
  });

  it("an offer may expire today (valid until the end of the day)", () => {
    assert.equal(offerCreateSchema.safeParse({ ...ok, expiresOn: today }).success, true);
  });

  it("rejects zero salary, joining today, past expiry, expiry after joining, missing expiry, extra fields", () => {
    fails(offerCreateSchema, { ...ok, salaryOffered: 0 });
    fails(offerCreateSchema, { ...ok, joiningDate: today });
    fails(offerCreateSchema, { ...ok, expiresOn: addDays(today, -1) });
    fails(offerCreateSchema, { ...ok, expiresOn: addDays(today, 31) });
    fails(offerCreateSchema, { salaryOffered: 1, joiningDate: ok.joiningDate });
    fails(offerCreateSchema, { ...ok, currency: "RUPEES" });
    fails(offerCreateSchema, { ...ok, status: "accepted" });
  });
});

describe("offer response and notification schemas", () => {
  it("offerResponseSchema accepts only accept / decline", () => {
    assert.equal(offerResponseSchema.parse({ decision: "accept" }).decision, "accept");
    fails(offerResponseSchema, { decision: "accepted" });
    fails(offerResponseSchema, { decision: "accept", candidateId: 1 });
  });

  it("notificationUpdateSchema only allows marking as read", () => {
    assert.deepEqual(notificationUpdateSchema.parse({ isRead: true }), { isRead: true });
    fails(notificationUpdateSchema, { isRead: false });
    fails(notificationUpdateSchema, { isRead: true, userId: 2 });
  });

  it("notificationListQuerySchema parses query strings and rejects unknown ones", () => {
    assert.deepEqual(notificationListQuerySchema.parse({}), { unreadOnly: false, limit: 50 });
    assert.deepEqual(notificationListQuerySchema.parse({ unreadOnly: "true", limit: "5" }), { unreadOnly: true, limit: 5 });
    fails(notificationListQuerySchema, { userId: "3" });
    fails(notificationListQuerySchema, { limit: "101" });
  });
});
