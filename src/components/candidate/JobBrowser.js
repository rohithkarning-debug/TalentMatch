"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, EMPLOYMENT_LABELS, EmptyState, formatDate, formatSalary, inputClass, labelClass, linkClass, PageHeader, PageShell, secondaryClass, SkeletonList, StatusBadge, Tag,
} from "@/components/ui";

const EMPTY_FILTERS = { q: "", location: "", employmentType: "", experience: "" };

export default function JobBrowser() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [jobs, setJobs] = useState(null);
  const [locations, setLocations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = useCallback(async (values) => {
    setBusy(true); setError("");
    const params = new URLSearchParams(Object.entries(values).filter(([, v]) => String(v).trim() !== ""));
    try {
      const response = await fetch(`/api/candidate/jobs?${params}`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.error?.message || "Jobs could not be loaded."); return; }
      setJobs(body.jobs); setLocations(body.locations || []);
    } catch {
      setError("Network error. Check that the server is running.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { search(EMPTY_FILTERS); }, [search]);

  const update = (key) => (e) => setFilters((old) => ({ ...old, [key]: e.target.value }));
  const submit = (e) => { e.preventDefault(); search(filters); };
  const clear = () => { setFilters(EMPTY_FILTERS); search(EMPTY_FILTERS); };

  return <PageShell>
      <PageHeader title="Browse open jobs" description="Only jobs that are currently open are listed. Open a job to see your skill gap before applying." />

      <form onSubmit={submit} role="search" className={`${cardClass} grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5`}>
        <label className={`${labelClass} lg:col-span-2`}>Keyword<input className={inputClass} type="search" value={filters.q} onChange={update("q")} maxLength={100} placeholder="Title, skill, company…" /></label>
        <label className={labelClass}>Location<select className={inputClass} value={filters.location} onChange={update("location")}><option value="">Any location</option>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <label className={labelClass}>Employment type<select className={inputClass} value={filters.employmentType} onChange={update("employmentType")}><option value="">Any type</option>{Object.entries(EMPLOYMENT_LABELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className={labelClass}>My experience (years)<input className={inputClass} type="number" min="0" max="60" step="0.5" value={filters.experience} onChange={update("experience")} placeholder="Any" title="Shows jobs whose minimum experience is at most this many years" /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button className={buttonClass} disabled={busy}>Search</button>
          <button type="button" className={secondaryClass} disabled={busy} onClick={clear}>Clear filters</button>
        </div>
      </form>

      <Alert lines={error ? [error] : null} />

      {jobs === null ? !error && <SkeletonList label="Loading jobs" /> : jobs && <>
        <p className="text-sm text-slate-600" aria-live="polite">{jobs.length} open {jobs.length === 1 ? "job" : "jobs"} found</p>
        <div className="space-y-3">
          {jobs.length === 0 && <EmptyState icon="search" title="No open jobs match these filters" message="Try a different keyword or clear the filters." action={<button type="button" className={secondaryClass} onClick={clear}>Clear filters</button>} />}
          {jobs.map((job) => <article key={job.id} className={`${cardClass} transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift motion-reduce:hover:translate-y-0`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900"><Link href={`/candidate/jobs/${job.id}`} className="hover:underline">{job.title}</Link></h2>
                <p className="text-sm text-slate-600">{job.company} · {job.location} · <span className="capitalize">{job.workMode}</span></p>
              </div>
              {job.hasApplied && <StatusBadge status="applied" />}
            </div>
            <p className="mt-2 text-sm text-slate-700">{EMPLOYMENT_LABELS[job.employmentType]} · {job.minExperienceYears}+ years experience · {formatSalary(job)}{job.closesAt && ` · closes ${formatDate(job.closesAt)}`}</p>
            <p className="mt-3 line-clamp-3 text-sm text-slate-600">{job.description}</p>
            {job.skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{job.skills.map((s) => <Tag key={s}>{s}</Tag>)}</div>}
            <Link href={`/candidate/jobs/${job.id}`} className={`${linkClass} mt-3 inline-block text-sm`}>{job.hasApplied ? "View application" : "View skill gap and apply"} →</Link>
          </article>)}
        </div>
      </>}
  </PageShell>;
}
