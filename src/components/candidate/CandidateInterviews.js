"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert, cardClass, EmptyState, errorLines, formatDateTime, linkClass, PageHeader, PageShell, request, sectionTitleClass, SkeletonList, StatusBadge,
} from "@/components/ui";

function InterviewItem({ iv }) {
  const isLink = /^https?:\/\//i.test(iv.locationOrLink || "");
  return <li className={cardClass}>
    <p className="font-medium text-slate-900">
      <Link href={`/candidate/jobs/${iv.jobId}`} className="hover:underline">{iv.jobTitle}</Link> · Round {iv.roundNo} <StatusBadge status={iv.status} />
    </p>
    <p className="text-sm text-slate-600">{iv.company}</p>
    <p className="mt-1 text-sm text-slate-800">
      {formatDateTime(iv.scheduledAt)} · {iv.durationMinutes} min · <span className="capitalize">{iv.mode}</span>
      {iv.locationOrLink && <> · {isLink ? <a href={iv.locationOrLink} className={linkClass} target="_blank" rel="noreferrer">{iv.locationOrLink}</a> : iv.locationOrLink}</>}
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

  return <PageShell>
      <PageHeader title="My interviews" description="Interviews scheduled by recruiters for your applications." />
      <Alert lines={error} />
      {interviews === null ? !error && <SkeletonList label="Loading interviews" /> : <>
        <section className="space-y-3">
          <h2 className={sectionTitleClass}>Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? <EmptyState icon="calendar" title="No upcoming interviews" message="When a recruiter schedules a round, it appears here and you get a notification." />
            : <ul className="space-y-3">{upcoming.map((iv) => <InterviewItem key={iv.id} iv={iv} />)}</ul>}
        </section>
        <section className="space-y-3">
          <h2 className={sectionTitleClass}>Past ({past.length})</h2>
          {past.length === 0 ? <EmptyState icon="calendar" title="No past interviews" />
            : <ul className="space-y-3">{past.map((iv) => <InterviewItem key={iv.id} iv={iv} />)}</ul>}
        </section>
      </>}
  </PageShell>;
}
