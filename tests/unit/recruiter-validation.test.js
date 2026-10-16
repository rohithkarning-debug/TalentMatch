// Unit tests for the recruiter matches query-string schema.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { jobMatchesQuerySchema } = await import("../../src/lib/recruiter/validation.js");

describe("jobMatchesQuerySchema", () => {
  it("defaults to all candidates, limit 10", () => {
    assert.deepEqual(jobMatchesQuerySchema.parse({}), { applicantsOnly: false, limit: 10 });
  });

  it("parses applicantsOnly and limit from strings", () => {
    assert.deepEqual(jobMatchesQuerySchema.parse({ applicantsOnly: "true", limit: "5" }), { applicantsOnly: true, limit: 5 });
    assert.equal(jobMatchesQuerySchema.parse({ applicantsOnly: "false" }).applicantsOnly, false);
  });

  it("rejects bad values and unknown parameters", () => {
    for (const bad of [{ applicantsOnly: "yes" }, { limit: "0" }, { limit: "51" }, { limit: "2.5" }, { limit: "abc" }, { sort: "asc" }]) {
      assert.equal(jobMatchesQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});

const { jobCreateSchema, jobUpdateSchema, applicationStatusSchema } = await import("../../src/lib/recruiter/validation.js");

const validJob = {
  title: "Data Engineer",
  description: "Build and maintain batch and streaming data pipelines in Python and SQL for analytics teams.",
  location: "Pune",
};

describe("jobCreateSchema", () => {
  it("fills defaults (draft, onsite, full time, INR, 1 opening, no skills)", () => {
    const job = jobCreateSchema.parse(validJob);
    assert.equal(job.status, "draft");
    assert.equal(job.workMode, "onsite");
    assert.equal(job.employmentType, "full_time");
    assert.equal(job.currency, "INR");
    assert.equal(job.openings, 1);
    assert.equal(job.minExperienceYears, 0);
    assert.equal(job.salaryMin, null);
    assert.deepEqual(job.skills, []);
  });

  it("parses skills with defaults for isRequired and minProficiency", () => {
    const job = jobCreateSchema.parse({ ...validJob, skills: [{ skillId: 3 }, { skillId: "7", isRequired: false, minProficiency: 2 }] });
    assert.deepEqual(job.skills, [{ skillId: 3, isRequired: true, minProficiency: 3 }, { skillId: 7, isRequired: false, minProficiency: 2 }]);
  });

  it("rejects bad input and fields the server must set itself", () => {
    const bad = [
      { ...validJob, description: "too short" },
      { ...validJob, title: "   " },
      { ...validJob, status: "archived" },
      { ...validJob, salaryMin: 20, salaryMax: 10 },
      { ...validJob, openings: 0 },
      { ...validJob, minExperienceYears: 1.25 },
      { ...validJob, closesAt: "31-10-2026" },
      { ...validJob, skills: [{ skillId: 1 }, { skillId: 1 }] },
      { ...validJob, skills: [{ skillId: 1, minProficiency: 6 }] },
      { ...validJob, companyId: 1 },
      { ...validJob, applicantCount: 99 },
    ];
    for (const input of bad) assert.equal(jobCreateSchema.safeParse(input).success, false, JSON.stringify(input));
  });
});

describe("jobUpdateSchema", () => {
  it("accepts a status-only change and rejects an empty body", () => {
    assert.deepEqual(jobUpdateSchema.parse({ status: "closed" }), { status: "closed" });
    assert.equal(jobUpdateSchema.safeParse({}).success, false);
    assert.equal(jobUpdateSchema.safeParse({ recruiterId: 5 }).success, false);
  });
});

describe("applicationStatusSchema", () => {
  it("accepts every known status (transition rules are left to the database)", () => {
    for (const status of ["applied", "shortlisted", "interviewed", "offered", "rejected"]) {
      assert.equal(applicationStatusSchema.safeParse({ status }).success, true, status);
    }
    assert.deepEqual(applicationStatusSchema.parse({ status: "rejected", note: "  Not a fit  " }), { status: "rejected", note: "Not a fit" });
  });

  it("rejects unknown statuses and extra fields", () => {
    for (const bad of [{ status: "hired" }, {}, { status: "shortlisted", changedBy: 1 }]) {
      assert.equal(applicationStatusSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});
