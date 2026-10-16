// Uploaded resume files, used by db:reset. Kept apart from reset.js so the
// safety checks can be unit-tested without running a reset.

import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The only folder whose files may be deleted (see persistResume()).
export const RESUME_DIR = path.join(ROOT, "uploads", "resumes");

// Deletes the regular files directly inside uploads/resumes/. Safety checks:
// the path must be exactly <repo>/uploads/resumes, the folder must be a real
// directory (not a symlink pointing elsewhere), and subfolders and symlinks
// inside it are left alone. A missing folder means there is nothing to do.
export async function clearUploadedResumes(dir = RESUME_DIR) {
  const resolved = path.resolve(dir);
  if (resolved !== RESUME_DIR) {
    throw new Error(`Refusing to delete files outside ${RESUME_DIR} (got ${resolved}).`);
  }
  let info;
  try { info = await lstat(resolved); } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing to clear ${resolved}: it is not a plain directory.`);
  }
  let deleted = 0;
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await unlink(path.join(resolved, entry.name));
    deleted += 1;
  }
  return deleted;
}
