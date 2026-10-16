"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, CtaArrow, EMPLOYMENT_LABELS, EmptyState, errorLines, Icon, mutedLabelClass, PageHeader, PageShell, request, SkeletonList, StatusBadge, Tag,
} from "@/components/ui";

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

  return <PageShell>
      <PageHeader title="My jobs" description="All job postings of your company. Applicant counts are maintained by a database trigger."
        actions={<Link href="/recruiter/jobs/new" className={buttonClass}><Icon name="plus" className="h-4 w-4" />Post a job</Link>} />
      <Alert lines={error} />
      {jobs === null ? !error && <SkeletonList label="Loading jobs" /> : <div className="space-y-3">
        {jobs.length === 0 && <EmptyState icon="briefcase" title="No jobs yet" message="Post your first job to start receiving ranked applicants."
          action={<Link href="/recruiter/jobs/new" className={buttonClass}>Post a job<CtaArrow /></Link>} />}
        {jobs.map((job) => <article key={job.id} className={`${cardClass} transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift motion-reduce:hover:translate-y-0`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                <Link href={`/recruiter/jobs/${job.id}`} className="hover:underline">{job.title}</Link> <StatusBadge status={job.status} />
              </h2>
              <p className="text-sm text-slate-600">
                {job.location} · <span className="capitalize">{job.workMode}</span> · {EMPLOYMENT_LABELS[job.employmentType]} · {job.openings} opening{job.openings === 1 ? "" : "s"}
                {job.postedBy && ` · posted by ${job.postedBy}`}
              </p>
            </div>
            <div className="flex items-baseline gap-1.5 sm:block sm:text-right">
              <p className="text-2xl font-semibold text-slate-900" title="jobs.applicant_count (trigger-maintained)">{job.applicantCount}</p>
              <p className={mutedLabelClass}>applicant{job.applicantCount === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
            {STAGES.map((s) => <span key={s} className="inline-flex items-center gap-1"><StatusBadge status={s} /><span className="tabular-nums">{job[s]}</span></span>)}
            <Tag>avg match {job.avgMatchScore == null ? "—" : job.avgMatchScore.toFixed(4)}</Tag>
            {!job.isEmbedded && <Tag className="bg-amber-50 text-amber-800">not embedded</Tag>}
          </div>
        </article>)}
      </div>}
  </PageShell>;
}
