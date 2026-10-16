"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, cardClass, errorLines, formatDateTime, NotificationsLink, pageClass, request, secondaryClass, StatusBadge } from "@/components/ui";

function InterviewItem({ iv }) {
  const isLink = /^https?:\/\//i.test(iv.locationOrLink || "");
  return <li className={cardClass}>
    <p className="font-medium text-zinc-900 dark:text-zinc-50">
      <Link href={`/candidate/jobs/${iv.jobId}`} className="hover:underline">{iv.jobTitle}</Link> · Round {iv.roundNo} <StatusBadge status={iv.status} />
    </p>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">{iv.company}</p>
    <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
      {formatDateTime(iv.scheduledAt)} · {iv.durationMinutes} min · <span className="capitalize">{iv.mode}</span>
      {iv.locationOrLink && <> · {isLink ? <a href={iv.locationOrLink} className="underline" target="_blank" rel="noreferrer">{iv.locationOrLink}</a> : iv.locationOrLink}</>}
    </p>
  </li>;
}

export default function CandidateInterviews() {
  const [interviews, setInterviews] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    request("/api/candidate/interviews").then((r) => {
      if (r.ok) setInterviews(r.body.interviews); else setError(errorLines(r.body, "Interviews could not be loaded."));
    });
  }, []);
  const upcoming = interviews?.filter((i) => i.isUpcoming) || [];
  const past = interviews?.filter((i) => !i.isUpcoming) || [];

  return <main className={pageClass}>
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex gap-4 text-sm"><Link href="/candidate" className="text-zinc-500 hover:underline">← Candidate dashboard</Link><Link href="/candidate/applications" className="text-zinc-500 hover:underline">My applications</Link></div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">My interviews</h1>
        </div>
        <div className="flex gap-2"><Link href="/candidate/offers" className={secondaryClass}>My offers</Link><NotificationsLink /></div>
      </header>
      <Alert lines={error} />
      {interviews === null ? !error && <p className="text-sm text-zinc-500">Loading interviews…</p> : <>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No upcoming interviews.</p>
            : <ul className="space-y-3">{upcoming.map((iv) => <InterviewItem key={iv.id} iv={iv} />)}</ul>}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Past ({past.length})</h2>
          {past.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No past interviews.</p>
            : <ul className="space-y-3">{past.map((iv) => <InterviewItem key={iv.id} iv={iv} />)}</ul>}
        </section>
      </>}
    </div>
  </main>;
}
