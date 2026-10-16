import { query as defaultQuery } from "../db.js";

// Skill gap: which of the job's REQUIRED skills does the candidate have, and
// which are missing?
//
//   have    = required skills that also appear in candidate_skills (JOIN).
//             meetsLevel says whether the candidate's proficiency reaches the
//             job's min_proficiency (the same rule rank_candidates_for_job()
//             uses for matched_skills).
//   missing = required skills EXCEPT the candidate's skills (set difference).
//
// Every required skill ends up in exactly one of the two lists.
export async function getSkillGap(jobId, candidateId, query = defaultQuery) {
  const [have, missing] = await Promise.all([
    query(
      `SELECT s.skill_id::int AS "skillId", s.name, js.min_proficiency AS "minProficiency",
              cs.proficiency, cs.proficiency >= js.min_proficiency AS "meetsLevel"
         FROM job_skills js
         JOIN skills s            ON s.skill_id = js.skill_id
         JOIN candidate_skills cs ON cs.skill_id = js.skill_id AND cs.candidate_id = $2
        WHERE js.job_id = $1 AND js.is_required
        ORDER BY s.name`, [jobId, candidateId]),
    query(
      `SELECT s.skill_id::int AS "skillId", s.name, js.min_proficiency AS "minProficiency"
         FROM (SELECT js.skill_id FROM job_skills js
                WHERE js.job_id = $1 AND js.is_required
               EXCEPT
               SELECT cs.skill_id FROM candidate_skills cs
                WHERE cs.candidate_id = $2) AS gap
         JOIN skills s      ON s.skill_id = gap.skill_id
         JOIN job_skills js ON js.job_id = $1 AND js.skill_id = gap.skill_id
        ORDER BY s.name`, [jobId, candidateId]),
  ]);
  return { have: have.rows, missing: missing.rows };
}
