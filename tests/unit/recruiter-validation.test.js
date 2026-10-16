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
