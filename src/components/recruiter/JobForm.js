"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, buttonClass, cardClass, EMPLOYMENT_LABELS, errorLines, inputClass, labelClass, pageClass, request, secondaryClass } from "@/components/ui";

const EMPTY = {
  title: "", description: "", location: "", workMode: "onsite", employmentType: "full_time",
  salaryMin: "", salaryMax: "", currency: "INR", openings: "1", minExperienceYears: "0", closesAt: "", status: "draft",
};

// Form values are strings; the API wants numbers or null.
function toPayload(form, skills) {
  const num = (v) => (String(v).trim() === "" ? null : Number(v));
  return {
    title: form.title, description: form.description, location: form.location,
    workMode: form.workMode, employmentType: form.employmentType,
    salaryMin: num(form.salaryMin), salaryMax: num(form.salaryMax), currency: form.currency,
    openings: Number(form.openings), minExperienceYears: Number(form.minExperienceYears),
    closesAt: form.closesAt || null, status: form.status,
    skills: skills.map(({ skillId, isRequired, minProficiency }) => ({ skillId, isRequired, minProficiency })),
  };
}

// Create (no jobId) or edit (jobId) a job posting.
export default function JobForm({ jobId }) {
  const router = useRouter();
  const [form, setForm] = useState(jobId ? null : EMPTY);
  const [skills, setSkills] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    request("/api/skills").then((r) => r.ok && setCatalog(r.body.skills));
    if (!jobId) return;
    request(`/api/recruiter/jobs/${jobId}`).then((r) => {
      if (!r.ok) { setError(errorLines(r.body, "Job could not be loaded.")); return; }
      const j = r.body.job;
      setForm({
        title: j.title, description: j.description, location: j.location, workMode: j.workMode,
        employmentType: j.employmentType, salaryMin: j.salaryMin ?? "", salaryMax: j.salaryMax ?? "",
        currency: j.currency, openings: String(j.openings), minExperienceYears: String(j.minExperienceYears),
        closesAt: j.closesAt || "", status: j.status,
      });
      setSkills(j.skills.map((s) => ({ skillId: s.skillId, name: s.name, isRequired: s.isRequired, minProficiency: s.minProficiency })));
    });
  }, [jobId]);

  const available = useMemo(() => catalog.filter((c) => !skills.some((s) => s.skillId === c.id)), [catalog, skills]);
  const set = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));
  const updateSkill = (skillId, patch) => setSkills((old) => old.map((s) => (s.skillId === skillId ? { ...s, ...patch } : s)));

  function addSkill() {
    const item = catalog.find((c) => c.id === Number(pick));
    if (!item) return;
    setSkills((old) => [...old, { skillId: item.id, name: item.name, isRequired: true, minProficiency: 3 }]);
    setPick("");
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const result = jobId
      ? await request(`/api/recruiter/jobs/${jobId}`, { method: "PATCH", json: toPayload(form, skills) })
      : await request("/api/recruiter/jobs", { method: "POST", json: toPayload(form, skills) });
    setBusy(false);
    if (!result.ok) { setError(errorLines(result.body, "The job could not be saved.")); return; }
    router.push(`/recruiter/jobs/${result.body.job.id}`);
  }

  return <main className={pageClass}>
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href={jobId ? `/recruiter/jobs/${jobId}` : "/recruiter"} className="text-sm text-zinc-500 hover:underline">← {jobId ? "Back to job" : "My jobs"}</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{jobId ? "Edit job" : "Post a job"}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Title, description and required skills are embedded for semantic matching when you save.</p>
      </header>
      <Alert lines={error} />
      {!form ? !error && <p className="text-sm text-zinc-500">Loading job…</p> : <form onSubmit={submit} className={`${cardClass} space-y-4`}>
        <label className={labelClass}>Title<input className={inputClass} value={form.title} onChange={set("title")} required maxLength={150} /></label>
        <label className={labelClass}>Description <span className="font-normal text-zinc-500">(at least 50 characters)</span>
          <textarea className={`${inputClass} min-h-40`} value={form.description} onChange={set("description")} required minLength={50} maxLength={10000} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={labelClass}>Location<input className={inputClass} value={form.location} onChange={set("location")} required maxLength={120} /></label>
          <label className={labelClass}>Work mode<select className={inputClass} value={form.workMode} onChange={set("workMode")}>{["onsite", "hybrid", "remote"].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label className={labelClass}>Employment type<select className={inputClass} value={form.employmentType} onChange={set("employmentType")}>{Object.entries(EMPLOYMENT_LABELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label className={labelClass}>Salary min (per year)<input className={inputClass} type="number" min="0" value={form.salaryMin} onChange={set("salaryMin")} /></label>
          <label className={labelClass}>Salary max (per year)<input className={inputClass} type="number" min="0" value={form.salaryMax} onChange={set("salaryMax")} /></label>
          <label className={labelClass}>Currency<input className={inputClass} value={form.currency} onChange={set("currency")} maxLength={3} required /></label>
          <label className={labelClass}>Openings<input className={inputClass} type="number" min="1" max="500" value={form.openings} onChange={set("openings")} required /></label>
          <label className={labelClass}>Min experience (years)<input className={inputClass} type="number" min="0" max="40" step="0.5" value={form.minExperienceYears} onChange={set("minExperienceYears")} required /></label>
          <label className={labelClass}>Closes on<input className={inputClass} type="date" value={form.closesAt} onChange={set("closesAt")} /></label>
        </div>
        <label className={`${labelClass} sm:w-1/3`}>Status<select className={inputClass} value={form.status} onChange={set("status")}>
          <option value="draft">Draft (not visible to candidates)</option><option value="open">Open (accepting applications)</option><option value="closed">Closed</option>
        </select></label>

        <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Skills</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className={`${labelClass} flex-1`}>Add a skill<select className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a skill…</option>{available.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.category}</option>)}
            </select></label>
            <button type="button" className={secondaryClass} onClick={addSkill} disabled={!pick}>Add</button>
          </div>
          {skills.length === 0 && <p className="text-sm text-zinc-500">No skills selected.</p>}
          {skills.map((s) => <div key={s.skillId} className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
            <span className="flex-1 font-medium text-zinc-900 dark:text-zinc-50">{s.name}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={s.isRequired} onChange={(e) => updateSkill(s.skillId, { isRequired: e.target.checked })} /> Required</label>
            <label className="flex items-center gap-1">Min level
              <select className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" value={s.minProficiency} onChange={(e) => updateSkill(s.skillId, { minProficiency: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </label>
            <button type="button" className="text-red-700 hover:underline dark:text-red-300" onClick={() => setSkills((old) => old.filter((x) => x.skillId !== s.skillId))}>Remove</button>
          </div>)}
        </fieldset>

        <div className="flex gap-2">
          <button className={buttonClass} disabled={busy}>{busy ? "Saving…" : jobId ? "Save changes" : "Create job"}</button>
          <Link href={jobId ? `/recruiter/jobs/${jobId}` : "/recruiter"} className={secondaryClass}>Cancel</Link>
        </div>
      </form>}
    </div>
  </main>;
}
