import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";

// GET /api/skills: the skill catalogue, for any signed-in user (recruiters
// pick a job's required skills from it). Read-only.
export const GET = withAuth({}, async () => {
  const { rows } = await query("SELECT skill_id::int AS id, name, category FROM skills ORDER BY category, name");
  return NextResponse.json({ skills: rows }, { headers: { "Cache-Control": "no-store" } });
});
