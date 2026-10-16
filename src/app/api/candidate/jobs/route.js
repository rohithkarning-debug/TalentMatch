import { NextResponse } from "next/server";
import { ROLES, withAuth } from "@/lib/auth/guards";
import { query } from "@/lib/db";
import { jobSearchSchema } from "@/lib/candidate/validation";

// Escape LIKE wildcards so a search for "100%" or "C_" matches literally.
const likePattern = (text) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

// GET /api/candidate/jobs?q=&location=&employmentType=&experience=
// Lists OPEN jobs only. Every filter value is passed as a $n parameter; the
// only thing built dynamically is the list of WHERE conditions, which are fixed
// strings written here.
export const GET = withAuth({ roles: [ROLES.CANDIDATE] }, async (request, { user }) => {
  const filters = jobSearchSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const values = [user.id];
  const where = ["j.status = 'open'"];
  if (filters.q) {
    values.push(likePattern(filters.q));
    const p = `$${values.length}`;
    where.push(`(j.title ILIKE ${p} OR j.description ILIKE ${p} OR c.name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
                  WHERE js.job_id = j.job_id AND s.name ILIKE ${p}))`);
  }
  if (filters.location) {
    values.push(likePattern(filters.location));
    where.push(`j.location ILIKE $${values.length}`);
  }
  if (filters.employmentType) {
    values.push(filters.employmentType);
    where.push(`j.employment_type = $${values.length}`);
  }
  if (filters.experience !== undefined) {
    // "I have N years" -> jobs whose minimum requirement is at most N.
    values.push(filters.experience);
    where.push(`j.min_experience_years <= $${values.length}`);
  }

  const [jobs, locations] = await Promise.all([
    query(
      `SELECT j.job_id::int AS id, j.title, c.name AS company, j.location, j.work_mode AS "workMode",
              j.employment_type AS "employmentType", j.min_experience_years::float8 AS "minExperienceYears",
              j.salary_min::float8 AS "salaryMin", j.salary_max::float8 AS "salaryMax", j.currency,
              j.openings, j.posted_at AS "postedAt", to_char(j.closes_at, 'YYYY-MM-DD') AS "closesAt", j.description,
              COALESCE((SELECT array_agg(s.name ORDER BY js.is_required DESC, s.name)
                          FROM job_skills js JOIN skills s ON s.skill_id = js.skill_id
                         WHERE js.job_id = j.job_id), '{}') AS skills,
              EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.job_id AND a.candidate_id = $1) AS "hasApplied"
         FROM jobs j
         JOIN companies c ON c.company_id = j.company_id
        WHERE ${where.join(" AND ")}
        ORDER BY j.posted_at DESC, j.job_id DESC
        LIMIT 100`, values),
    query("SELECT DISTINCT location FROM jobs WHERE status = 'open' ORDER BY location"),
  ]);
  return NextResponse.json(
    { jobs: jobs.rows, locations: locations.rows.map((r) => r.location) },
    { headers: { "Cache-Control": "no-store" } });
});
