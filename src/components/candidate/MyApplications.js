"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, EmptyState, errorLines, formatDateTime, formatScore, mutedLabelClass, PageHeader, PageShell, request, SkeletonList, StatusBadge, StatusTimeline,
} from "@/components/ui";

export default function MyApplications() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    request("/api/candidate/applications").then((r) => {
      if (r.ok) setApps(r.body.applications); else setError(errorLines(r.body, "Applications could not be loaded."));
    });
  }, []);

  return <PageShell>
      <PageHeader title="My applications" description="Current status, match score and every status change, recorded by the database." />
      <Alert lines={error} />
      {apps === null ? !error && <SkeletonList label="Loading applications" />
        : apps.length === 0 ? <EmptyState icon="file" title="No applications yet" message="When you apply to a job, its status and match score show up here."
            action={<Link href="/candidate/jobs" className={buttonClass}>Browse open jobs</Link>} />
        : <ul className="space-y-3">{apps.map((a) => <li key={a.id} className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                <Link href={`/candidate/jobs/${a.jobId}`} className="hover:underline">{a.jobTitle}</Link> <StatusBadge status={a.status} />
              </h2>
              <p className="text-sm text-slate-600">{a.company} · {a.location} · applied {formatDateTime(a.appliedAt)}{a.jobStatus !== "open" && ` · job ${a.jobStatus}`}</p>
              <p className="text-xs text-slate-500">Resume sent: {a.resumeFileName || "deleted"}</p>
              {a.nextInterviewAt && <p className="mt-1 text-sm text-purple-700">Next interview: {formatDateTime(a.nextInterviewAt)}</p>}
              {a.offerStatus && <p className="mt-1 text-sm text-emerald-800">Offer: {a.offerStatus} · <Link href="/candidate/offers" className="underline">view offer</Link></p>}
            </div>
            <div className="text-right">
              <p className="font-mono text-lg text-slate-900">{formatScore(a.matchScore)}</p>
              <p className={mutedLabelClass}>match score</p>
            </div>
          </div>
          <div className="mt-4"><StatusTimeline history={a.history} /></div>
        </li>)}</ul>}
  </PageShell>;
}
