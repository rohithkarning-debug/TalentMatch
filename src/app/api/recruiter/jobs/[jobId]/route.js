import { NextResponse } from "next/server";
import { assertSameOrigin, readJsonBody } from "@/lib/api/request";
import { ApiError, notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getPool } from "@/lib/db";
import { idParamSchema } from "@/lib/validation/auth";
import { assertJobInRecruiterCompany, JOB_COLUMNS, loadJobDetail, replaceJobSkills } from "@/lib/recruiter/jobs";
import { EMBEDDED_JOB_FIELDS, jobUpdateSchema } from "@/lib/recruiter/validation";
import { tryEmbedJob } from "@/lib/vector-store";

function parseJobId(params) {
  const parsed = idParamSchema.safeParse(params.jobId);
  if (!parsed.success) throw notFound("Job not found");
  return parsed.data;
}

const noStore = { headers: { "Cache-Control": "no-store" } };

// GET /api/recruiter/jobs/:jobId: one job of the recruiter's company.
export const GET = withAuth({ roles: [ROLES.RECRUITER] }, async (_request, { user, params }) => {
  const jobId = parseJobId(params);
  await assertJobInRecruiterCompany(jobId, user);
  return NextResponse.json({ job: await loadJobDetail(jobId) }, noStore);
});

// PATCH /api/recruiter/jobs/:jobId: edit any subset of fields, including
// status (draft / open / closed) and the skill list.
export const PATCH = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const jobId = parseJobId(params);
  const data = await readJsonBody(request, jobUpdateSchema);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Ownership check and row lock in one step: FOR UPDATE makes a concurrent
    // edit of the same job wait until we COMMIT.
    await assertJobInRecruiterCompany(jobId, user, { query: (t, p) => client.query(t, p), lock: true });
    const sets = [];
    const values = [jobId];
    for (const [field, column] of Object.entries(JOB_COLUMNS)) {
      if (data[field] === undefined) continue;
      values.push(data[field]);
      sets.push(`${column} = $${values.length}`);
    }
    // updated_at is set by trg_jobs_set_updated_at, never here.
    if (sets.length) await client.query(`UPDATE jobs SET ${sets.join(", ")} WHERE job_id = $1`, values);
    if (data.skills !== undefined) await replaceJobSkills(client, jobId, data.skills);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
  // Re-embed only when the embedded text can have changed (title,
  // description, skills). A pure status change keeps the old vector.
  if (EMBEDDED_JOB_FIELDS.some((f) => data[f] !== undefined)) await tryEmbedJob(jobId);
  return NextResponse.json({ job: await loadJobDetail(jobId) }, noStore);
});

// DELETE /api/recruiter/jobs/:jobId. job_skills and job_embeddings go with it
// (ON DELETE CASCADE). A job that already has applications cannot be deleted:
// applications_job_fkey is ON DELETE RESTRICT so hiring history is never
// lost. The recruiter is told to close the job instead.
export const DELETE = withAuth({ roles: [ROLES.RECRUITER] }, async (request, { user, params }) => {
  assertSameOrigin(request);
  const jobId = parseJobId(params);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertJobInRecruiterCompany(jobId, user, { query: (t, p) => client.query(t, p), lock: true });
    await client.query("DELETE FROM jobs WHERE job_id = $1", [jobId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.code === "23503" && err?.constraint === "applications_job_fkey") {
      throw new ApiError(409, "JOB_HAS_APPLICATIONS",
        "This job already has applications, so it cannot be deleted. Close it instead to stop new applications.");
    }
    throw err;
  } finally { client.release(); }
  return NextResponse.json({ ok: true }, noStore);
});
