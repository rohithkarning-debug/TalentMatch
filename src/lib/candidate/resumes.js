import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "resumes");

export function safeDisplayName(name) {
  const base = path.basename(String(name || "resume")).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>:"/\\|?*]/g, "_").trim();
  return (base || "resume").slice(0, 255);
}

export async function extractResumeText(buffer, mimeType) {
  let text;
  if (mimeType === "text/plain") {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } else {
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    let pdf;
    try { pdf = await task.promise; } catch (err) { throw describePdfError(err); }
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" "));
        page.cleanup();
      }
      text = pages.join("\n");
    } finally { await task.destroy(); } // pdfjs 6: the loading task owns the document and worker
  }
  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 50) {
    const hint = mimeType === "application/pdf" ? " Scanned (image-only) PDFs have no selectable text; export the resume as a text-based PDF instead." : "";
    throw Object.assign(new Error(`Resume must contain at least 50 characters of extractable text.${hint}`), { status: 400, code: "INSUFFICIENT_TEXT" });
  }
  return text;
}

// Call inside a transaction before changing which resume is primary.
// Locking the candidate's own row (not the resumes rows) also works when the
// candidate has no resumes yet, so two uploads in parallel cannot both decide
// "there is no primary, make mine primary". The second waits for the first.
// NO KEY UPDATE is the weakest lock that blocks another resume transaction;
// unlike FOR UPDATE it does not block FK checks (e.g. a new application).
export async function lockCandidateResumes(client, candidateId) {
  await client.query("SELECT user_id FROM candidates WHERE user_id = $1 FOR NO KEY UPDATE", [candidateId]);
}

// Problems with the uploaded file become a 400 the candidate can act on.
// Anything else (e.g. the parser failing to load) is left as a server error.
function describePdfError(err) {
  if (err?.name === "PasswordException") {
    return Object.assign(new Error("This PDF is password-protected. Upload a version without a password."), { status: 400, code: "PDF_ENCRYPTED" });
  }
  if (err?.name === "InvalidPDFException" || err?.name === "FormatError") {
    return Object.assign(new Error("This PDF is damaged or not a valid PDF file."), { status: 400, code: "INVALID_PDF" });
  }
  return err;
}

export async function persistResume(buffer, fileName) {
  await mkdir(UPLOAD_ROOT, { recursive: true });
  const diskName = `${randomUUID()}.resume`;
  const fullPath = path.join(UPLOAD_ROOT, diskName);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(fullPath, buffer, { flag: "wx", mode: 0o600 });
  return { storagePath: `uploads/resumes/${diskName}`, fullPath };
}

export async function removeStoredResume(storagePath) {
  if (!storagePath) return;
  const expectedPrefix = "uploads/resumes/";
  if (!storagePath.startsWith(expectedPrefix)) return;
  const resolved = path.resolve(process.cwd(), storagePath);
  if (!resolved.startsWith(`${UPLOAD_ROOT}${path.sep}`)) return;
  try { await unlink(resolved); } catch (err) { if (err.code !== "ENOENT") throw err; }
}
