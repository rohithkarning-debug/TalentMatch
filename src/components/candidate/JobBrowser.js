"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const buttonClass = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const secondaryClass = "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
const labelClass = "block text-sm font-medium text-zinc-800 dark:text-zinc-200";

const EMPLOYMENT_LABELS = { full_time: "Full time", part_time: "Part time", contract: "Contract", internship: "Internship" };
const EMPTY_FILTERS = { q: "", location: "", employmentType: "", experience: "" };

function formatSalary(job) {
  if (job.salaryMin == null && job.salaryMax == null) return "Salary not disclosed";
  const lakh = (v) => `${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  const range = [job.salaryMin, job.salaryMax].filter((v) => v != null).map(lakh).join(" – ");
  return `${job.currency === "INR" ? "₹" : `${job.currency} `}${range} per year`;
}

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

  return <main className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-black sm:px-6 lg:px-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <Link href="/candidate" className="text-sm text-zinc-500 hover:underline">← Candidate dashboard</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Browse open jobs</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">Only jobs that are currently open are listed.</p>
      </header>

      <form onSubmit={submit} className="grid items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2 lg:grid-cols-5">
        <label className={`${labelClass} lg:col-span-2`}>Keyword<input className={inputClass} type="search" value={filters.q} onChange={update("q")} maxLength={100} placeholder="Title, skill, company…" /></label>
        <label className={labelClass}>Location<select className={inputClass} value={filters.location} onChange={update("location")}><option value="">Any location</option>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <label className={labelClass}>Employment type<select className={inputClass} value={filters.employmentType} onChange={update("employmentType")}><option value="">Any type</option>{Object.entries(EMPLOYMENT_LABELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className={labelClass}>My experience (years)<input className={inputClass} type="number" min="0" max="60" step="0.5" value={filters.experience} onChange={update("experience")} placeholder="Any" title="Shows jobs whose minimum experience is at most this many years" /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button className={buttonClass} disabled={busy}>Search</button>
          <button type="button" className={secondaryClass} disabled={busy} onClick={clear}>Clear filters</button>
        </div>
      </form>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {jobs === null ? <p className="text-sm text-zinc-500">Loading jobs…</p> : <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">{jobs.length} open {jobs.length === 1 ? "job" : "jobs"} found</p>
        <div className="space-y-3">
          {jobs.length === 0 && <p className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800">No open jobs match these filters.</p>}
          {jobs.map((job) => <article key={job.id} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{job.title}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.company} · {job.location} · <span className="capitalize">{job.workMode}</span></p>
              </div>
              {job.hasApplied && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Applied</span>}
            </div>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{EMPLOYMENT_LABELS[job.employmentType]} · {job.minExperienceYears} + years experience · {formatSalary(job)}{job.closesAt && ` · closes ${new Date(job.closesAt).toLocaleDateString()}`}</p>
            <p className="mt-3 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{job.description}</p>
            {job.skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{job.skills.map((s) => <span key={s} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{s}</span>)}</div>}
          </article>)}
        </div>
      </>}
    </div>
  </main>;
}
