"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, buttonClass, cardClass, EMPLOYMENT_LABELS, errorLines, pageClass, request, StatusBadge } from "@/components/ui";

const STAGES = ["applied", "shortlisted", "interviewed", "offered", "rejected"];

export default function RecruiterJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    request("/api/recruiter/jobs").then((r) => {
      if (r.ok) setJobs(r.body.jobs);
      else setError(errorLines(r.body, "Jobs could not be loaded."));
    });
  }, []);

  return <main className={pageClass}>
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">← TalentMatch home</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">My jobs</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">All job postings of your company. Applicant counts are maintained by a database trigger.</p>
        </div>
        <Link href="/recruiter/jobs/new" className={buttonClass}>+ Post a job</Link>
      </header>
      <Alert lines={error} />
      {jobs === null ? !error && <p className="text-sm text-zinc-500">Loading jobs…</p> : <div className="space-y-3">
        {jobs.length === 0 && <p className={`${cardClass} text-sm text-zinc-500`}>No jobs yet. Post your first job.</p>}
        {jobs.map((job) => <article key={job.id} className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                <Link href={`/recruiter/jobs/${job.id}`} className="hover:underline">{job.title}</Link> <StatusBadge status={job.status} />
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {job.location} · <span className="capitalize">{job.workMode}</span> · {EMPLOYMENT_LABELS[job.employmentType]} · {job.openings} opening{job.openings === 1 ? "" : "s"}
                {job.postedBy && ` · posted by ${job.postedBy}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50" title="jobs.applicant_count (trigger-maintained)">{job.applicantCount}</p>
              <p className="text-xs text-zinc-500">applicant{job.applicantCount === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            {STAGES.map((s) => <span key={s} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800"><span className="capitalize">{s}</span> {job[s]}</span>)}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">avg match {job.avgMatchScore == null ? "—" : job.avgMatchScore.toFixed(4)}</span>
            {!job.isEmbedded && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">not embedded</span>}
          </div>
        </article>)}
      </div>}
    </div>
  </main>;
}
