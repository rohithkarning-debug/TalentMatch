// db:reset deletes uploaded resume files, so the folder check must refuse
// every path other than <repo>/uploads/resumes before touching anything.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { clearUploadedResumes, RESUME_DIR } from "../../scripts/lib/uploads.js";

describe("clearUploadedResumes", () => {
  it("only accepts <repo>/uploads/resumes", () => {
    assert.equal(path.basename(RESUME_DIR), "resumes");
    assert.equal(path.basename(path.dirname(RESUME_DIR)), "uploads");
  });

  for (const dir of [
    path.dirname(RESUME_DIR),                          // uploads/
    path.dirname(path.dirname(RESUME_DIR)),            // the repo itself
    path.join(RESUME_DIR, "nested"),                   // a subfolder
    path.join(RESUME_DIR, "..", "..", "src"),          // ../ tricks
    path.join(path.parse(RESUME_DIR).root, "uploads", "resumes"), // same name, other place
  ]) {
    it(`refuses ${path.relative(path.dirname(path.dirname(RESUME_DIR)), dir) || "."}`, async () => {
      await assert.rejects(clearUploadedResumes(dir), /Refusing to delete files outside/);
    });
  }
});
