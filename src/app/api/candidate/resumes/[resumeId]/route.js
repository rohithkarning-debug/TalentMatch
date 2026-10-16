import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getPool } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { lockCandidateResumes, removeStoredResume } from "@/lib/candidate/resumes";
import { resumeUpdateSchema } from "@/lib/candidate/validation";

export const DELETE = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const parsed = idParamSchema.safeParse(params.resumeId);
  if (!parsed.success) throw notFound("Resume not found");
  const client = await getPool().connect();
  let storedPath;
  try {
    await client.query("BEGIN");
    await lockCandidateResumes(client, user.id);
    const found = await client.query("SELECT storage_path, is_primary FROM resumes WHERE resume_id = $1 AND candidate_id = $2", [parsed.data, user.id]);
    if (!found.rowCount) throw notFound("Resume not found");
    storedPath = found.rows[0].storage_path;
    await client.query("DELETE FROM resumes WHERE resume_id = $1 AND candidate_id = $2", [parsed.data, user.id]);
    // Deleting the primary resume promotes the newest remaining one.
    if (found.rows[0].is_primary) {
      await client.query("UPDATE resumes SET is_primary = TRUE WHERE resume_id = (SELECT resume_id FROM resumes WHERE candidate_id = $1 ORDER BY uploaded_at DESC, resume_id DESC LIMIT 1)", [user.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  await removeStoredResume(storedPath).catch((err) => console.error("[candidate] could not remove resume file", err?.code));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

// Make one of the candidate's own resumes the primary one. A single transaction
// unsets the old primary and sets the new one, so the candidate never has zero
// or two primaries. The order matters: the partial unique index
// resumes_one_primary_per_candidate is checked per statement, so the old
// primary has to be cleared before the new one is set.
export const PATCH = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const parsed = idParamSchema.safeParse(params.resumeId);
  if (!parsed.success) throw notFound("Resume not found");
  await readJsonBody(request, resumeUpdateSchema);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockCandidateResumes(client, user.id);
    const found = await client.query("SELECT 1 FROM resumes WHERE resume_id = $1 AND candidate_id = $2", [parsed.data, user.id]);
    if (!found.rowCount) throw notFound("Resume not found");
    await client.query("UPDATE resumes SET is_primary = FALSE WHERE candidate_id = $1 AND is_primary AND resume_id <> $2", [user.id, parsed.data]);
    const { rows } = await client.query(
      `UPDATE resumes SET is_primary = TRUE WHERE resume_id = $1 AND candidate_id = $2
       RETURNING resume_id AS id, file_name AS "fileName", mime_type AS "mimeType", file_size_bytes AS "fileSizeBytes", is_primary AS "isPrimary", uploaded_at AS "uploadedAt"`,
      [parsed.data, user.id]);
    await client.query("COMMIT");
    return NextResponse.json({ resume: rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
});
