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
    const pdf = await task.promise;
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => typeof item.str === "string" ? item.str : "").join(" "));
        page.cleanup();
      }
      text = pages.join("\n");
    } finally { await pdf.destroy(); }
  }
  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 50) throw Object.assign(new Error("Resume must contain at least 50 characters of extractable text"), { status: 400, code: "INSUFFICIENT_TEXT" });
  return text;
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
