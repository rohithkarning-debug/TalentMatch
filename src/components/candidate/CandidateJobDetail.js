"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, EMPLOYMENT_LABELS, errorLines, formatDate, formatDateTime, formatSalary, formatScore, inputClass, labelClass, linkClass, PageShell, request, sectionTitleClass, SkeletonList, StatusBadge,
} from "@/components/ui";

// Required skills the candidate has vs is missing (computed in SQL with
// EXCEPT, see src/lib/candidate/skill-gap.js).
function SkillGap({ gap }) {
  const total = gap.have.length + gap.missing.length;
  if (total === 0) return <p className="text-sm text-slate-500">This job lists no required skills.</p>;
  return <div className="grid gap-4 sm:grid-cols-2">
    <div>
      <h3 className="text-sm font-medium text-emerald-800">You have ({gap.have.length}/{total})</h3>
      {gap.have.length === 0 ? <p className="mt-1 text-sm text-slate-500">None of the required skills yet.</p> : <ul className="mt-2 space-y-1">
        {gap.have.map((s) => <li key={s.skillId} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-1.5 text-sm">
          <span className="text-emerald-900">✓ {s.name}</span>
          <span className={`text-xs ${s.meetsLevel ? "text-emerald-700" : "text-amber-700"}`}>
            your level {s.proficiency} / needed {s.minProficiency}{s.meetsLevel ? "" : " (below level)"}
          </span>
        </li>)}
      </ul>}
    </div>
    <div>
      <h3 className="text-sm font-medium text-red-800">Missing ({gap.missing.length}/{total})</h3>
      {gap.missing.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nothing missing. You list every required skill.</p> : <ul className="mt-2 space-y-1">
        {gap.missing.map((s) => <li key={s.skillId} className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-1.5 text-sm">
          <span className="text-red-900">✗ {s.name}</span>
          <span className="text-xs text-red-700">needed level {s.minProficiency}</span>
        </li>)}
      </ul>}
    </div>
  </div>;
}

export default function CandidateJobDetail({ jobId }) {
  const [data, setData] = useState(null);
  const [resumes, setResumes] = useState([]);
  const [resumeId, setResumeId] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [j, r] = await Promise.all([request(`/api/candidate/jobs/${jobId}`), request("/api/candidate/resumes")]);
    if (!j.ok) { setError(errorLines(j.body, "Job could not be loaded.")); return; }
    setData(j.body);
    if (r.ok) {
      setResumes(r.body.resumes);
      const primary = r.body.resumes.find((x) => x.isPrimary) || r.body.resumes[0];
      setResumeId((old) => old || (primary ? String(primary.id) : ""));
    }
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function apply(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const r = await request("/api/candidate/applications", {
      method: "POST", json: { jobId: Number(jobId), resumeId: Number(resumeId), coverLetter: coverLetter.trim() || null },
    });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "Application could not be submitted.")); return; }
    const score = r.body.application.matchScore;
    setNotice([`Application submitted. Match score: ${formatScore(score)}`,
      ...(score == null ? ["Your resume or this job is not embedded yet, so no score was computed. It stays empty rather than guessed."] : [])]);
    await load();
  }

  const job = data?.job;
  return <PageShell>
      <Link href="/candidate/jobs" className={`${linkClass} text-sm`}>← Back to jobs</Link>
      <Alert lines={error} />
      <Alert lines={notice} kind="success" />
      {!job ? !error && <SkeletonList rows={2} label="Loading job" /> : <>
        <article className={cardClass}>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{job.title} {job.status !== "open" && <StatusBadge status={job.status} />}</h1>
          <p className="mt-1 text-sm text-slate-600">{job.company}{job.industry && ` (${job.industry})`} · {job.location} · <span className="capitalize">{job.workMode}</span></p>
          <p className="mt-2 text-sm text-slate-700">{EMPLOYMENT_LABELS[job.employmentType]} · {job.minExperienceYears}+ years · {formatSalary(job)} · {job.openings} opening{job.openings === 1 ? "" : "s"}{job.closesAt && ` · closes ${formatDate(job.closesAt)}`}</p>
          <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{job.description}</p>
          {job.skills.some((s) => !s.isRequired) && <p className="mt-3 text-xs text-slate-500">Nice to have: {job.skills.filter((s) => !s.isRequired).map((s) => s.name).join(", ")}</p>}
        </article>

        <section className={cardClass}>
          <h2 className={`mb-3 ${sectionTitleClass}`}>Skill gap</h2>
          <SkillGap gap={data.skillGap} />
          <p className="mt-3 text-xs text-slate-500">Based on the skills in your <Link href="/candidate" className={linkClass}>profile</Link>.</p>
        </section>

        <section className={cardClass}>
          {job.application ? <div>
            <h2 className={sectionTitleClass}>Your application</h2>
            <p className="mt-2 text-sm text-slate-700">Status <StatusBadge status={job.application.status} /> · match score <span className="font-mono">{formatScore(job.application.matchScore)}</span> · applied {formatDateTime(job.application.appliedAt)}</p>
            <Link href="/candidate/applications" className={`${linkClass} mt-2 inline-block text-sm`}>See the status history →</Link>
          </div> : job.status !== "open" ? <p className="text-sm text-slate-600">This job is no longer accepting applications.</p>
          : <form onSubmit={apply} className="space-y-3">
            <h2 className={sectionTitleClass}>Apply</h2>
            {resumes.length === 0 ? <p className="text-sm text-slate-600">Upload a resume on your <Link href="/candidate" className={linkClass}>profile</Link> before applying.</p> : <>
              <label className={labelClass}>Resume to send<select className={inputClass} value={resumeId} onChange={(e) => setResumeId(e.target.value)} required>
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.fileName}{r.isPrimary ? " (primary)" : ""}{r.isEmbedded ? "" : " (not embedded, no score)"}</option>)}
              </select></label>
              <label className={labelClass}>Cover letter <span className="font-normal text-slate-500">(optional)</span><textarea className={`${inputClass} min-h-24`} value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} maxLength={5000} /></label>
              <button className={buttonClass} disabled={busy || !resumeId}>{busy ? "Submitting…" : "Apply now"}</button>
            </>}
          </form>}
        </section>
      </>}
  </PageShell>;
}
