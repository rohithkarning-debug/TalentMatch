"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, dangerClass, errorLines, formatDateTime, inputClass, labelClass,
  NotificationsLink, pageClass, request, secondaryClass, StatusBadge,
} from "@/components/ui";
import { localInputToIso } from "@/components/recruiter/PipelineForms";

// One interview with its actions. Only 'scheduled' interviews can change;
// if someone else changed it meanwhile, the database (trg_interviews_guard)
// refuses and its message is shown.
function InterviewCard({ iv, onChanged }) {
  const [mode, setMode] = useState(null); // "reschedule" | "complete" | null
  const [when, setWhen] = useState("");
  const [rating, setRating] = useState("4");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send(json) {
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/interviews/${iv.id}`, { method: "PATCH", json });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "Interview could not be updated.")); return; }
    setMode(null); onChanged();
  }

  const cancel = () => {
    const reason = window.prompt("Cancel this interview? Optional reason for the candidate:", "");
    if (reason !== null) send({ action: "cancel", reason: reason.trim() || null });
  };

  return <li className={cardClass}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-medium text-zinc-900 dark:text-zinc-50">{iv.candidateName} · Round {iv.roundNo} <StatusBadge status={iv.status} /></p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <Link href={`/recruiter/jobs/${iv.jobId}`} className="hover:underline">{iv.jobTitle}</Link> · application <StatusBadge status={iv.applicationStatus} />
        </p>
        <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
          {formatDateTime(iv.scheduledAt)} · {iv.durationMinutes} min · <span className="capitalize">{iv.mode}</span>{iv.locationOrLink && ` · ${iv.locationOrLink}`}
        </p>
        {iv.interviewerName && <p className="text-xs text-zinc-500">Interviewer: {iv.interviewerName}</p>}
        {iv.status === "completed" && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">Rating <b>{iv.rating}/5</b>: {iv.feedback}</p>}
        {iv.status === "scheduled" && !iv.isUpcoming && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">The time has passed. Mark it completed or cancel it.</p>}
      </div>
      {iv.status === "scheduled" && !mode && <div className="flex flex-wrap gap-2">
        <button className={secondaryClass} onClick={() => setMode("reschedule")} disabled={busy}>Reschedule</button>
        <button className={secondaryClass} onClick={() => setMode("complete")} disabled={busy}>Mark completed</button>
        <button className={dangerClass} onClick={cancel} disabled={busy}>Cancel</button>
      </div>}
    </div>
    {mode === "reschedule" && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); send({ action: "reschedule", scheduledAt: localInputToIso(when) }); }}>
      <label className={labelClass}>New date and time<input type="datetime-local" required className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <button className={buttonClass} disabled={busy}>Save</button>
      <button type="button" className={secondaryClass} onClick={() => setMode(null)}>Back</button>
    </form>}
    {mode === "complete" && <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); send({ action: "complete", rating: Number(rating), feedback }); }}>
      <label className={labelClass}>Rating (1-5)
        <select className={`${inputClass} w-24`} value={rating} onChange={(e) => setRating(e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
      <label className={labelClass}>Feedback (internal, not shown to the candidate)
        <textarea required className={inputClass} rows={3} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy}>Save</button><button type="button" className={secondaryClass} onClick={() => setMode(null)}>Back</button></div>
    </form>}
    {error && <div className="mt-3"><Alert lines={error} /></div>}
  </li>;
}

export default function RecruiterInterviews() {
  const [interviews, setInterviews] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    const r = await request("/api/recruiter/interviews");
    if (r.ok) { setInterviews(r.body.interviews); setError(null); } else setError(errorLines(r.body, "Interviews could not be loaded."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const upcoming = interviews?.filter((i) => i.isUpcoming) || [];
  const past = interviews?.filter((i) => !i.isUpcoming) || [];

  return <main className={pageClass}>
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/recruiter" className="text-sm text-zinc-500 hover:underline">← My jobs</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Interviews</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">All interviews for your company&apos;s jobs. Schedule new rounds from a job&apos;s applicant list.</p>
        </div>
        <div className="flex gap-2"><Link href="/recruiter/offers" className={secondaryClass}>Offers</Link><NotificationsLink /></div>
      </header>
      <Alert lines={error} />
      {interviews === null ? !error && <p className="text-sm text-zinc-500">Loading interviews…</p> : <>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No upcoming interviews.</p>
            : <ul className="space-y-3">{upcoming.map((iv) => <InterviewCard key={iv.id} iv={iv} onChanged={load} />)}</ul>}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Past and closed ({past.length})</h2>
          {past.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>Nothing here yet.</p>
            : <ul className="space-y-3">{past.map((iv) => <InterviewCard key={iv.id} iv={iv} onChanged={load} />)}</ul>}
        </section>
      </>}
    </div>
  </main>;
}
