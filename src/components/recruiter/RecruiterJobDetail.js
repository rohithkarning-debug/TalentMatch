"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, dangerClass, EMPLOYMENT_LABELS, errorLines, formatDate, formatDateTime, formatMoney,
  formatSalary, formatScore, inputClass, pageClass, request, secondaryClass, StatusBadge, StatusTimeline,
} from "@/components/ui";
import { MakeOfferForm, ScheduleInterviewForm } from "@/components/recruiter/PipelineForms";

const APPLICATION_STATUSES = ["applied", "shortlisted", "interviewed", "offered", "rejected"];

// Matched vs required skills side by side: matched ones in green, the rest grey.
function SkillMatch({ matched, required }) {
  if (!required.length) return <span className="text-xs text-zinc-500">No required skills</span>;
  return <div className="flex flex-wrap items-center gap-1">
    <span className="mr-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{matched.length}/{required.length}</span>
    {required.map((s) => <span key={s} className={`rounded-full px-2 py-0.5 text-xs ${matched.includes(s)
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800"}`}>{s}</span>)}
  </div>;
}

function ScoreBar({ score }) {
  if (score == null) return <span className="text-xs text-zinc-500" title="Resume or job not embedded yet">not scored</span>;
  const pct = Math.max(0, Math.min(100, score * 100));
  return <div className="w-28">
    <p className="font-mono text-sm text-zinc-900 dark:text-zinc-50">{formatScore(score)}</p>
    <div className="mt-1 h-1.5 rounded bg-zinc-200 dark:bg-zinc-800"><div className="h-1.5 rounded bg-zinc-800 dark:bg-zinc-200" style={{ width: `${pct}%` }} /></div>
  </div>;
}

// Interviews and offer of one applicant, with the next possible action.
// The buttons only appear when the action makes sense, but the database
// still decides (e.g. an offer on a non-interviewed application fails).
function PipelinePanel({ app, onChanged }) {
  const [form, setForm] = useState(null); // "interview" | "offer" | null
  const canSchedule = ["shortlisted", "interviewed"].includes(app.status);
  const canOffer = app.status === "interviewed" && !app.offer;
  const done = () => { setForm(null); onChanged(); };

  return <div className="mt-3 space-y-2">
    {(app.interviews.length > 0 || app.offer) && <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
      {app.interviews.map((i) => <span key={i.id} className="rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-800">
        Round {i.roundNo} · {formatDateTime(i.scheduledAt)} · {i.mode} · <StatusBadge status={i.status} />{i.rating ? ` · ${i.rating}/5` : ""}
      </span>)}
      {app.offer && <span className="rounded-lg border border-emerald-200 px-2 py-1 dark:border-emerald-900">
        Offer {formatMoney(app.offer.salaryOffered, app.offer.currency)} · joins {formatDate(app.offer.joiningDate)} · <StatusBadge status={app.offer.status} />
      </span>}
      <Link href="/recruiter/interviews" className="underline">manage interviews</Link>
      {app.offer && <Link href="/recruiter/offers" className="underline">manage offers</Link>}
    </div>}
    {!form && (canSchedule || canOffer) && <div className="flex gap-2">
      {canSchedule && <button type="button" className={secondaryClass} onClick={() => setForm("interview")}>Schedule interview</button>}
      {canOffer && <button type="button" className={secondaryClass} onClick={() => setForm("offer")}>Make offer</button>}
    </div>}
    {form === "interview" && <ScheduleInterviewForm applicationId={app.id} isFirst={app.status !== "interviewed"} onDone={done} onCancel={() => setForm(null)} />}
    {form === "offer" && <MakeOfferForm applicationId={app.id} onDone={done} onCancel={() => setForm(null)} />}
  </div>;
}

// One applicant: score, skills, and the status changer. Every status is
// offered in the dropdown on purpose. The database decides what is allowed,
// and its error message is shown as is.
function ApplicantRow({ app, rank, onChanged }) {
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  async function change(e) {
    e.preventDefault();
    if (!status) return;
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/applications/${app.id}`, { method: "PATCH", json: { status, note: note.trim() || null } });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "Status could not be changed.")); return; }
    setStatus(""); setNote(""); onChanged();
  }

  return <li className={cardClass}>
    <div className="flex flex-wrap items-start gap-4">
      <span className="w-6 pt-0.5 text-sm text-zinc-500">#{rank}</span>
      <div className="min-w-48 flex-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">{app.fullName} <StatusBadge status={app.status} /></p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{app.headline || "No headline"} · {app.yearsExperience} yrs · applied {formatDateTime(app.appliedAt)}</p>
        <p className="text-xs text-zinc-500">Resume: {app.resumeFileName || "deleted by candidate"}</p>
      </div>
      <ScoreBar score={app.matchScore} />
      <div className="w-full sm:w-72"><SkillMatch matched={app.matchedSkills} required={app.requiredSkills} /></div>
    </div>
    <form onSubmit={change} className="mt-3 flex flex-wrap items-end gap-2">
      <select aria-label={`New status for ${app.fullName}`} className={`${inputClass} mt-0 w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Change status…</option>
        {APPLICATION_STATUSES.filter((s) => s !== app.status).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <input aria-label="Note" className={`${inputClass} mt-0 flex-1`} placeholder="Note for the history (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <button className={buttonClass} disabled={busy || !status}>{busy ? "Saving…" : "Update"}</button>
      <button type="button" className={secondaryClass} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"} history ({app.history.length})</button>
    </form>
    {error && <div className="mt-3"><Alert lines={error} /></div>}
    <PipelinePanel app={app} onChanged={onChanged} />
    {open && <div className="mt-4">
      {app.coverLetter && <p className="mb-3 rounded-lg bg-zinc-50 p-3 text-sm italic text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">“{app.coverLetter}”</p>}
      <StatusTimeline history={app.history} />
    </div>}
  </li>;
}

function ApplicantsTab({ jobId }) {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    const r = await request(`/api/recruiter/jobs/${jobId}/applications`);
    if (r.ok) { setApps(r.body.applications); setError(null); } else setError(errorLines(r.body, "Applicants could not be loaded."));
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  return <div className="space-y-3">
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Ranked by match score = 1 − (resume ⟷ job cosine distance), computed in PostgreSQL when the candidate applied, using the resume they chose.
      Allowed moves: applied → shortlisted → interviewed → offered, or any active stage → rejected. The database rejects anything else.
      “Interviewed” and “offered” are reached by scheduling an interview and making an offer.
    </p>
    <Alert lines={error} />
    {apps === null ? !error && <p className="text-sm text-zinc-500">Loading applicants…</p>
      : apps.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No applications yet.</p>
      : <ol className="space-y-3">{apps.map((a, i) => <ApplicantRow key={a.id} app={a} rank={i + 1} onChanged={load} />)}</ol>}
  </div>;
}

function SearchTab({ jobId }) {
  const [limit, setLimit] = useState("20");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const search = useCallback(async (n) => {
    setBusy(true);
    const r = await request(`/api/recruiter/jobs/${jobId}/matches?limit=${n}&applicantsOnly=false`);
    setBusy(false);
    if (r.ok) { setResult(r.body); setError(null); } else { setResult(null); setError(errorLines(r.body, "Matches could not be loaded.")); }
  }, [jobId]);
  useEffect(() => { search("20"); }, [search]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Every candidate's primary resume, nearest first, from <code>rank_candidates_for_job()</code> (pgvector <code>&lt;=&gt;</code>, HNSW index).
        Includes people who have not applied.
      </p>
      <label className="text-sm">Show top <select className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" value={limit}
        onChange={(e) => { setLimit(e.target.value); search(e.target.value); }}>{["5", "10", "20", "50"].map((n) => <option key={n}>{n}</option>)}</select></label>
    </div>
    <Alert lines={error} />
    {busy && !result && <p className="text-sm text-zinc-500">Searching…</p>}
    {result && <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Similarity</th><th className="px-4 py-2">Matched / required skills</th><th className="px-4 py-2">Applied?</th></tr>
        </thead>
        <tbody>{result.matches.map((m, i) => <tr key={m.candidateId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
          <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
          <td className="px-4 py-3"><p className="font-medium text-zinc-900 dark:text-zinc-50">{m.fullName}</p><p className="text-xs text-zinc-500">{m.yearsExperience} yrs experience</p></td>
          <td className="px-4 py-3"><ScoreBar score={m.similarity} /></td>
          <td className="px-4 py-3"><SkillMatch matched={m.matchedSkillNames} required={result.job.requiredSkills} /></td>
          <td className="px-4 py-3">{m.hasApplied ? <StatusBadge status={m.applicationStatus} /> : <span className="text-xs text-zinc-500">not applied</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

export default function RecruiterJobDetail({ jobId }) {
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState("applicants");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await request(`/api/recruiter/jobs/${jobId}`);
    if (r.ok) setJob(r.body.job); else setError(errorLines(r.body, "Job could not be loaded."));
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(status) {
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/jobs/${jobId}`, { method: "PATCH", json: { status } });
    setBusy(false);
    if (r.ok) setJob(r.body.job); else setError(errorLines(r.body, "Status could not be changed."));
  }

  async function remove() {
    if (!window.confirm("Delete this job permanently? This only works if nobody has applied yet.")) return;
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/jobs/${jobId}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) router.push("/recruiter"); else setError(errorLines(r.body, "Job could not be deleted."));
  }

  const tabClass = (name) => `rounded-t-lg px-4 py-2 text-sm font-medium ${tab === name
    ? "border border-b-0 border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`;

  return <main className={pageClass}>
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/recruiter" className="text-sm text-zinc-500 hover:underline">← My jobs</Link>
      <Alert lines={error} />
      {!job ? !error && <p className="text-sm text-zinc-500">Loading job…</p> : <>
        <header className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{job.title} <StatusBadge status={job.status} /></h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{job.company} · {job.location} · <span className="capitalize">{job.workMode}</span> · {EMPLOYMENT_LABELS[job.employmentType]} · {formatSalary(job)}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {job.applicantCount} applicant{job.applicantCount === 1 ? "" : "s"} · {job.minExperienceYears}+ yrs · {job.openings} opening{job.openings === 1 ? "" : "s"}
                {job.closesAt && ` · closes ${job.closesAt}`} · {job.isEmbedded ? `embedded ${formatDateTime(job.embeddedAt)}` : "not embedded yet"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {job.status !== "open" && <button className={buttonClass} disabled={busy} onClick={() => setStatus("open")}>{job.status === "draft" ? "Publish" : "Reopen"}</button>}
              {job.status === "open" && <button className={secondaryClass} disabled={busy} onClick={() => setStatus("closed")}>Close job</button>}
              {job.status === "open" && <button className={secondaryClass} disabled={busy} onClick={() => setStatus("draft")}>Back to draft</button>}
              <Link href={`/recruiter/jobs/${job.id}/edit`} className={secondaryClass}>Edit</Link>
              <button className={dangerClass} disabled={busy} onClick={remove}>Delete</button>
            </div>
          </div>
          <details className="mt-3 text-sm text-zinc-700 dark:text-zinc-300"><summary className="cursor-pointer text-zinc-500">Description and skills</summary>
            <p className="mt-2 whitespace-pre-line">{job.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{job.skills.map((s) => <span key={s.skillId} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{s.name} · {s.isRequired ? `required ≥${s.minProficiency}` : "nice to have"}</span>)}</div>
          </details>
        </header>
        <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
          <button role="tab" aria-selected={tab === "applicants"} className={tabClass("applicants")} onClick={() => setTab("applicants")}>Ranked applicants</button>
          <button role="tab" aria-selected={tab === "search"} className={tabClass("search")} onClick={() => setTab("search")}>Search all candidates</button>
        </nav>
        {tab === "applicants" ? <ApplicantsTab jobId={job.id} /> : <SearchTab jobId={job.id} />}
      </>}
    </div>
  </main>;
}
