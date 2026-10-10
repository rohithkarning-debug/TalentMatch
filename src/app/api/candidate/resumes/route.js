import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/request";
import { ApiError, notFound } from "@/lib/api/errors";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { getPool, query } from "@/lib/db";
import { extractResumeText, MAX_RESUME_BYTES, persistResume, safeDisplayName } from "@/lib/candidate/resumes";


export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (_request, { user }) => {
  const { rows } = await query(
    `SELECT resume_id AS id, file_name AS "fileName", mime_type AS "mimeType", file_size_bytes AS "fileSizeBytes",
            is_primary AS "isPrimary", uploaded_at AS "uploadedAt"
       FROM resumes WHERE candidate_id = $1 ORDER BY uploaded_at DESC, resume_id DESC`, [user.id]);
  return NextResponse.json({ resumes: rows }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  assertSameOrigin(request);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_RESUME_BYTES + 65536) throw new ApiError(413, "FILE_SIZE", "Resume upload exceeds the 5 MB limit");
  let form;
  try { form = await request.formData(); } catch { throw new ApiError(400, "INVALID_UPLOAD", "Could not read uploaded file"); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new ApiError(400, "FILE_REQUIRED", "Choose a PDF or text resume to upload");
  if (!file.size || file.size > MAX_RESUME_BYTES) throw new ApiError(413, "FILE_SIZE", "Resume must be between 1 byte and 5 MB");
  const displayName = safeDisplayName(file.name);
  const lower = displayName.toLowerCase();
  let mimeType;
  if (lower.endsWith(".pdf") && (file.type === "application/pdf" || !file.type || file.type === "application/octet-stream")) mimeType = "application/pdf";
  else if ((lower.endsWith(".txt") || lower.endsWith(".text")) && (file.type === "text/plain" || !file.type || file.type === "application/octet-stream")) mimeType = "text/plain";
  else throw new ApiError(415, "FILE_TYPE", "Only PDF and plain-text (.txt) resumes are allowed");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (mimeType === "application/pdf" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ApiError(400, "INVALID_PDF", "The uploaded file is not a valid PDF");
  let extractedText;
  try { extractedText = await extractResumeText(buffer, mimeType); }
  catch (err) { if (err.status) throw new ApiError(err.status, err.code || "INVALID_RESUME", err.message); throw new ApiError(400, "RESUME_PARSE_FAILED", "Could not extract text from this resume. Use a text-based PDF or .txt file."); }
  const stored = await persistResume(buffer, displayName);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const primary = await client.query("SELECT 1 FROM resumes WHERE candidate_id = $1 AND is_primary = TRUE LIMIT 1", [user.id]);
    const { rows } = await client.query(
      `INSERT INTO resumes (candidate_id, file_name, storage_path, mime_type, file_size_bytes, extracted_text, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING resume_id AS id, file_name AS "fileName", mime_type AS "mimeType", file_size_bytes AS "fileSizeBytes", is_primary AS "isPrimary", uploaded_at AS "uploadedAt"`,
      [user.id, displayName, stored.storagePath, mimeType, buffer.length, extractedText, primary.rowCount === 0]);
    await client.query("COMMIT");
    return NextResponse.json({ resume: rows[0] }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await client.query("ROLLBACK");
    const { removeStoredResume } = await import("@/lib/candidate/resumes");
    await removeStoredResume(stored.storagePath).catch(() => {});
    throw err;
  } finally { client.release(); }
});
