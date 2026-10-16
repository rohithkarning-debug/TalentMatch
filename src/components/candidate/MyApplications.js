"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, cardClass, errorLines, formatDateTime, formatScore, pageClass, request, StatusBadge, StatusTimeline } from "@/components/ui";

export default function MyApplications() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    request("/api/candidate/applications").then((r) => {
      if (r.ok) setApps(r.body.applications); else setError(errorLines(r.body, "Applications could not be loaded."));
    });
  }, []);

  return <main className={pageClass}>
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <div className="flex gap-4 text-sm"><Link href="/candidate" className="text-zinc-500 hover:underline">← Candidate dashboard</Link><Link href="/candidate/jobs" className="text-zinc-500 hover:underline">Browse jobs →</Link></div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">My applications</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Current status, match score and every status change, recorded by the database.</p>
      </header>
      <Alert lines={error} />
      {apps === null ? !error && <p className="text-sm text-zinc-500">Loading applications…</p>
        : apps.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>You have not applied to any job yet.</p>
        : <ul className="space-y-3">{apps.map((a) => <li key={a.id} className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                <Link href={`/candidate/jobs/${a.jobId}`} className="hover:underline">{a.jobTitle}</Link> <StatusBadge status={a.status} />
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.company} · {a.location} · applied {formatDateTime(a.appliedAt)}{a.jobStatus !== "open" && ` · job ${a.jobStatus}`}</p>
              <p className="text-xs text-zinc-500">Resume sent: {a.resumeFileName || "deleted"}</p>
              {a.nextInterviewAt && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Next interview: {formatDateTime(a.nextInterviewAt)}</p>}
              {a.offerStatus && <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">Offer: {a.offerStatus}</p>}
            </div>
            <div className="text-right">
              <p className="font-mono text-lg text-zinc-900 dark:text-zinc-50">{formatScore(a.matchScore)}</p>
              <p className="text-xs text-zinc-500">match score</p>
            </div>
          </div>
          <div className="mt-4"><StatusTimeline history={a.history} /></div>
        </li>)}</ul>}
    </div>
  </main>;
}
