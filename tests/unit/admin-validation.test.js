// Admin request schemas (src/lib/admin/validation.js). No server, no database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  companyCreateSchema, companyUpdateSchema, recruiterCreateSchema, recruiterUpdateSchema,
} from "../../src/lib/admin/validation.js";

const recruiter = { fullName: "Test Recruiter", email: "Test.Recruiter@Example.COM", password: "Abcdefg123", companyId: "3" };

describe("companyCreateSchema", () => {
  it("trims, turns empty optional text into NULL and fills missing optionals with NULL", () => {
    assert.deepEqual(companyCreateSchema.parse({ name: "  Acme  ", industry: "", website: "https://acme.example" }),
      { name: "Acme", industry: null, location: null, website: "https://acme.example", description: null });
  });
  it("rejects a blank name, a non-http website and unknown fields", () => {
    assert.equal(companyCreateSchema.safeParse({ name: "   " }).success, false);
    assert.equal(companyCreateSchema.safeParse({ name: "Acme", website: "acme.example" }).success, false);
    assert.equal(companyCreateSchema.safeParse({ name: "Acme", company_id: 1 }).success, false);
    assert.equal(companyCreateSchema.safeParse({ name: "x".repeat(151) }).success, false);
  });
});

describe("companyUpdateSchema", () => {
  it("keeps only the fields that were sent (no NULL defaults on PATCH)", () => {
    assert.deepEqual(companyUpdateSchema.parse({ location: "Pune" }), { location: "Pune" });
    assert.deepEqual(companyUpdateSchema.parse({ website: "" }), { website: null });
  });
  it("requires at least one field", () => {
    assert.equal(companyUpdateSchema.safeParse({}).success, false);
  });
});

describe("recruiterCreateSchema", () => {
  it("normalises email to lower case and coerces companyId", () => {
    const out = recruiterCreateSchema.parse(recruiter);
    assert.equal(out.email, "test.recruiter@example.com");
    assert.equal(out.companyId, 3);
    assert.equal(out.designation, null);
    assert.equal(out.phone, null);
  });
  it("applies the same password rule as registration", () => {
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, password: "short1" }).success, false);
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, password: "onlyletters" }).success, false);
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, password: `a1${"x".repeat(71)}` }).success, false, "over 72 bytes");
  });
  it("rejects a role field, a bad phone and a bad company id", () => {
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, role: "admin" }).success, false);
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, phone: "call me" }).success, false);
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, companyId: 0 }).success, false);
    assert.equal(recruiterCreateSchema.safeParse({ ...recruiter, companyId: "abc" }).success, false);
  });
});

describe("recruiterUpdateSchema", () => {
  it("accepts isActive alone and nothing else is filled in", () => {
    assert.deepEqual(recruiterUpdateSchema.parse({ isActive: false }), { isActive: false });
  });
  it("rejects non-boolean isActive, password changes and empty bodies", () => {
    assert.equal(recruiterUpdateSchema.safeParse({ isActive: "false" }).success, false);
    assert.equal(recruiterUpdateSchema.safeParse({ password: "Abcdefg123" }).success, false);
    assert.equal(recruiterUpdateSchema.safeParse({}).success, false);
  });
});
