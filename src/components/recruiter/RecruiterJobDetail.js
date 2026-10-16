"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, dangerClass, EMPLOYMENT_LABELS, EmptyState, errorLines, formatDate, formatDateTime, formatMoney, formatSalary, formatScore, inlineInputClass, inputClass, labelClass, linkClass, PageShell, request, secondaryClass, SkeletonList, StatusBadge, StatusTimeline, tableClass, tableWrapClass, tdClass, thClass, theadClass, trClass,
} from "@/components/ui";
import { MakeOfferForm, ScheduleInterviewForm } from "@/components/recruiter/PipelineForms";

const APPLICATION_STATUSES = ["applied", "shortlisted", "interviewed", "offered", "rejected"];

// Matched vs required skills side by side: matched ones in green, the rest grey.
function SkillMatch({ matched, required }) {
  if (!required.length) return <span className="text-xs text-slate-500">No required skills</span>;
  return <div className="flex flex-wrap items-center gap-1">
    <span className="mr-1 text-xs font-medium text-slate-700">{matched.length}/{required.length}</span>
    {required.map((s) => <span key={s} className={`rounded-full px-2 py-0.5 text-xs ${matched.includes(s)
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
      : "bg-slate-100 text-slate-500 line-through"}`}>{s}</span>)}
  </div>;
}

function ScoreBar({ score }) {
  if (score == null) return <span className="text-xs text-slate-500" title="Resume or job not embedded yet">not scored</span>;
  const pct = Math.max(0, Math.min(100, score * 100));
  return <div className="w-28">
    <p className="font-mono text-sm text-slate-900">{formatScore(score)}</p>
    <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${pct}%` }} /></div>
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
    {(app.interviews.length > 0 || app.offer) && <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      {app.interviews.map((i) => <span key={i.id} className="rounded-lg border border-slate-200 px-2 py-1">
        Round {i.roundNo} · {formatDateTime(i.scheduledAt)} · {i.mode} · <StatusBadge status={i.status} />{i.rating ? ` · ${i.rating}/5` : ""}
      </span>)}
      {app.offer && <span className="rounded-lg border border-emerald-200 px-2 py-1">
        Offer {formatMoney(app.offer.salaryOffered, app.offer.currency)} · joins {formatDate(app.offer.joiningDate)} · <StatusBadge status={app.offer.status} />
      </span>}
      <Link href="/recruiter/interviews" className={linkClass}>manage interviews</Link>
      {app.offer && <Link href="/recruiter/offers" className={linkClass}>manage offers</Link>}
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
      <span className="w-6 pt-0.5 text-sm text-slate-500">#{rank}</span>
      <div className="min-w-48 flex-1">
        <p className="font-medium text-slate-900">{app.fullName} <StatusBadge status={app.status} /></p>
        <p className="text-sm text-slate-600">{app.headline || "No headline"} · {app.yearsExperience} yrs · applied {formatDateTime(app.appliedAt)}</p>
        <p className="text-xs text-slate-500">Resume: {app.resumeFileName || "deleted by candidate"}</p>
      </div>
      <ScoreBar score={app.matchScore} />
      <div className="w-full sm:w-72"><SkillMatch matched={app.matchedSkills} required={app.requiredSkills} /></div>
    </div>
    <form onSubmit={change} className="mt-3 flex flex-wrap items-end gap-2">
      <select aria-label={`New status for ${app.fullName}`} className={`${inlineInputClass} w-full sm:w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Change status…</option>
        {APPLICATION_STATUSES.filter((s) => s !== app.status).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <input aria-label="Note" className={`${inlineInputClass} min-w-0 flex-1 basis-56`} placeholder="Note for the history (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <button className={buttonClass} disabled={busy || !status}>{busy ? "Saving…" : "Update"}</button>
      <button type="button" className={secondaryClass} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"} history ({app.history.length})</button>
    </form>
    {error && <div className="mt-3"><Alert lines={error} /></div>}
    <PipelinePanel app={app} onChanged={onChanged} />
    {open && <div className="mt-4">
      {app.coverLetter && <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm italic text-slate-700">“{app.coverLetter}”</p>}
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
    <p className="text-sm text-slate-600">
      Ranked by match score = 1 − (resume ⟷ job cosine distance), computed in PostgreSQL when the candidate applied, using the resume they chose.
      Allowed moves: applied → shortlisted → interviewed → offered, or any active stage → rejected. The database rejects anything else.
      “Interviewed” and “offered” are reached by scheduling an interview and making an offer.
    </p>
    <Alert lines={error} />
    {apps === null ? !error && <SkeletonList label="Loading applicants" />
      : apps.length === 0 ? <EmptyState icon="users" title="No applications yet" message="Applicants appear here ranked by match score. Use “Search all candidates” to find people who have not applied." />
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
      <p className="max-w-2xl text-sm text-slate-600">
        Every candidate's primary resume, nearest first, from <code>rank_candidates_for_job()</code> (pgvector <code>&lt;=&gt;</code>, HNSW index).
        Includes people who have not applied.
      </p>
      <label className={`${labelClass} flex items-center gap-2`}>Show top <select className={`${inlineInputClass} w-20 py-1.5`} value={limit}
        onChange={(e) => { setLimit(e.target.value); search(e.target.value); }}>{["5", "10", "20", "50"].map((n) => <option key={n}>{n}</option>)}</select></label>
    </div>
    <Alert lines={error} />
    {busy && !result && <SkeletonList rows={1} label="Searching" />}
    {result && <div className={tableWrapClass}>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr><th className={thClass}>#</th><th className={thClass}>Candidate</th><th className={thClass}>Similarity</th><th className={thClass}>Matched / required skills</th><th className={thClass}>Applied?</th></tr>
        </thead>
        <tbody>{result.matches.map((m, i) => <tr key={m.candidateId} className={trClass}>
          <td className={`${tdClass} text-slate-500`}>{i + 1}</td>
          <td className={tdClass}><p className="font-medium text-slate-900">{m.fullName}</p><p className="text-xs text-slate-500">{m.yearsExperience} yrs experience</p></td>
          <td className={tdClass}><ScoreBar score={m.similarity} /></td>
          <td className={tdClass}><SkillMatch matched={m.matchedSkillNames} required={result.job.requiredSkills} /></td>
          <td className={tdClass}>{m.hasApplied ? <StatusBadge status={m.applicationStatus} /> : <span className="text-xs text-slate-500">not applied</span>}</td>
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
    ? "-mb-px border border-b-white border-slate-200 bg-white text-indigo-700"
    : "text-slate-500 hover:text-slate-800"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;

  return <PageShell>
      <Link href="/recruiter" className={`${linkClass} text-sm`}>← My jobs</Link>
      <Alert lines={error} />
      {!job ? !error && <SkeletonList rows={2} label="Loading job" /> : <>
        <header className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{job.title} <StatusBadge status={job.status} /></h1>
              <p className="mt-1 text-sm text-slate-600">{job.company} · {job.location} · <span className="capitalize">{job.workMode}</span> · {EMPLOYMENT_LABELS[job.employmentType]} · {formatSalary(job)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {job.applicantCount} applicant{job.applicantCount === 1 ? "" : "s"} · {job.minExperienceYears}+ yrs · {job.openings} opening{job.openings === 1 ? "" : "s"}
                {job.closesAt && ` · closes ${formatDate(job.closesAt)}`} · {job.isEmbedded ? `embedded ${formatDateTime(job.embeddedAt)}` : "not embedded yet"}
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
          <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer text-slate-500">Description and skills</summary>
            <p className="mt-2 whitespace-pre-line">{job.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{job.skills.map((s) => <span key={s.skillId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{s.name} · {s.isRequired ? `required ≥${s.minProficiency}` : "nice to have"}</span>)}</div>
          </details>
        </header>
        <nav className="flex gap-1 border-b border-slate-200" role="tablist">
          <button role="tab" aria-selected={tab === "applicants"} className={tabClass("applicants")} onClick={() => setTab("applicants")}>Ranked applicants</button>
          <button role="tab" aria-selected={tab === "search"} className={tabClass("search")} onClick={() => setTab("search")}>Search all candidates</button>
        </nav>
        {tab === "applicants" ? <ApplicantsTab jobId={job.id} /> : <SearchTab jobId={job.id} />}
      </>}
  </PageShell>;
}
