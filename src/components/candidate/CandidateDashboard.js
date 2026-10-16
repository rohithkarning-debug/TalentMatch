"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, buttonClass, Card, formatDate, Icon, inputClass, labelClass, PageHeader, PageShell, request, secondaryClass, SkeletonList } from "@/components/ui";

function Section({ title, description, children }) {
  return <Card title={title} description={description}>{children}</Card>;
}

function Field({ label, name, value, onChange, type = "text", ...props }) {
  return <label className={labelClass}>{label}<input className={inputClass} name={name} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...props} /></label>;
}

export default function CandidateDashboard() {
  const [profile, setProfile] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [skills, setSkills] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [skillId, setSkillId] = useState("");
  const [proficiency, setProficiency] = useState("3");
  const [yearsUsed, setYearsUsed] = useState("0");
  const [selectedFile, setSelectedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    const [p, s, r] = await Promise.all([
      request("/api/candidate/profile"), request("/api/candidate/skills"), request("/api/candidate/resumes"),
    ]);
    const failed = [p, s, r].find((x) => !x.ok);
    if (failed) { setError(failed.body?.error?.message || "Could not load candidate data."); return; }
    setProfile(p.body.profile);
    setCatalog(s.body.catalog || []);
    setSkills(s.body.skills || []);
    setResumes(r.body.resumes || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const availableSkills = useMemo(() => catalog.filter((item) => !skills.some((own) => own.id === item.id)), [catalog, skills]);
  const updateProfileField = (key, value) => setProfile((old) => ({ ...old, [key]: value }));

  async function saveProfile(e) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    // Optional columns come back from the API as null, so trim a "" fallback instead.
    const text = (value) => (value ?? "").trim();
    try {
      const payload = {
        fullName: text(profile.fullName), phone: text(profile.phone) || null,
        location: text(profile.location) || null, headline: text(profile.headline) || null,
        yearsExperience: Number(profile.yearsExperience || 0), highestEducation: text(profile.highestEducation) || null,
      };
      const result = await request("/api/candidate/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!result.ok) { setError(result.body?.error?.message || "Profile could not be saved."); return; }
      setProfile(result.body.profile); setNotice("Profile saved successfully.");
    } finally { setBusy(false); }
  }

  async function addSkill(e) {
    e.preventDefault(); if (!skillId) return;
    setBusy(true); setError(""); setNotice("");
    const result = await request("/api/candidate/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId: Number(skillId), proficiency: Number(proficiency), yearsUsed: Number(yearsUsed) }) });
    setBusy(false);
    if (!result.ok) { setError(result.body?.error?.message || "Skill could not be saved."); return; }
    setSkillId(""); setNotice("Skill added or updated."); await refresh();
  }

  async function removeSkill(id) {
    if (!window.confirm("Remove this skill from your profile?")) return;
    setBusy(true); setError("");
    const result = await request(`/api/candidate/skills/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.body?.error?.message || "Skill could not be removed."); return; }
    setSkills((old) => old.filter((item) => item.id !== id)); setNotice("Skill removed.");
  }

  async function uploadResume(e) {
    e.preventDefault(); if (!selectedFile) return;
    // React clears e.currentTarget once the handler yields, so keep the form now.
    const formElement = e.currentTarget;
    setBusy(true); setError(""); setNotice("");
    const form = new FormData(); form.append("file", selectedFile);
    const result = await request("/api/candidate/resumes", { method: "POST", body: form });
    setBusy(false);
    if (!result.ok) { setError(result.body?.error?.message || "Resume upload failed."); return; }
    setSelectedFile(null); formElement.reset(); setNotice("Resume uploaded successfully."); await refresh();
  }

  async function makePrimary(id) {
    setBusy(true); setError(""); setNotice("");
    const result = await request(`/api/candidate/resumes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPrimary: true }) });
    setBusy(false);
    if (!result.ok) { setError(result.body?.error?.message || "Primary resume could not be changed."); return; }
    setNotice("Primary resume updated."); await refresh();
  }

  async function deleteResume(id) {
    if (!window.confirm("Delete this resume? Applications using it will keep their records, but will no longer reference this resume.")) return;
    setBusy(true); setError(""); setNotice("");
    const result = await request(`/api/candidate/resumes/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!result.ok) { setError(result.body?.error?.message || "Resume could not be deleted."); return; }
    setNotice("Resume deleted."); await refresh();
  }

  return <PageShell>
      <PageHeader title="My profile" description="Your profile, skills and resumes. Recruiters see these when you apply."
        actions={<><button className={secondaryClass} onClick={refresh} disabled={busy}>Refresh</button><Link href="/candidate/jobs" className={buttonClass}><Icon name="search" className="h-4 w-4" />Browse open jobs</Link></>} />
      <Alert lines={error ? [error] : null} />
      <Alert lines={notice ? [notice] : null} kind="success" />
      {!profile ? !error && <SkeletonList rows={3} label="Loading your profile" /> : <>
        <Section title="Personal details" description="Saved to your candidate profile in the database.">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" value={profile.fullName} onChange={(v) => updateProfileField("fullName", v)} required minLength={2} maxLength={120} />
              <label className={labelClass}>Email<input className={`${inputClass} opacity-70`} value={profile.email} readOnly /></label>
              <Field label="Phone" name="phone" value={profile.phone || ""} onChange={(v) => updateProfileField("phone", v)} placeholder="+91 98765 43210" />
              <Field label="Location" name="location" value={profile.location || ""} onChange={(v) => updateProfileField("location", v)} maxLength={120} placeholder="City, country" />
              <Field label="Headline" name="headline" value={profile.headline || ""} onChange={(v) => updateProfileField("headline", v)} maxLength={150} placeholder="e.g. Computer science student" />
              <Field label="Years of experience" name="yearsExperience" type="number" value={profile.yearsExperience} onChange={(v) => updateProfileField("yearsExperience", v)} min="0" max="60" step="0.5" required />
              <div className="sm:col-span-2"><Field label="Highest education" name="highestEducation" value={profile.highestEducation || ""} onChange={(v) => updateProfileField("highestEducation", v)} maxLength={120} placeholder="e.g. B.Tech Computer Science" /></div>
            </div>
            <button className={buttonClass} disabled={busy}>Save profile</button>
          </form>
        </Section>
        <Section title="My skills" description="Choose a catalogue skill and record your proficiency and years of use.">
          <form onSubmit={addSkill} className="grid items-end gap-3 sm:grid-cols-4">
            <label className={`${labelClass} sm:col-span-2`}>Skill<select className={inputClass} value={skillId} onChange={(e) => setSkillId(e.target.value)} required><option value="">Choose a skill…</option>{availableSkills.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.category}</option>)}</select></label>
            <label className={labelClass}>Proficiency<select className={inputClass} value={proficiency} onChange={(e) => setProficiency(e.target.value)}>{[[1,"Beginner"],[2,"Basic"],[3,"Intermediate"],[4,"Advanced"],[5,"Expert"]].map(([v,t]) => <option key={v} value={v}>{v} — {t}</option>)}</select></label>
            <label className={labelClass}>Years used<input className={inputClass} type="number" min="0" max="60" step="0.5" value={yearsUsed} onChange={(e) => setYearsUsed(e.target.value)} required /></label>
            <div className="sm:col-span-4"><button className={buttonClass} disabled={busy || !availableSkills.length}>{availableSkills.length ? "Add skill" : "All catalogue skills added"}</button></div>
          </form>
          <div className="mt-5 space-y-2">{skills.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">You haven't added any skills yet. Skills power the skill-gap view on every job.</p> : skills.map((s) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div><p className="font-medium text-slate-900">{s.name} <span className="text-xs font-normal text-slate-500">· {s.category}</span></p><p className="text-sm text-slate-600">Proficiency {s.proficiency}/5 · {s.yearsUsed} years</p></div><button className={secondaryClass} disabled={busy} onClick={() => removeSkill(s.id)}>Remove</button></div>)}</div>
        </Section>
        <Section title="My resumes" description="PDF and plain-text resumes up to 5 MB. Text must be extractable for this module to save it.">
          <form onSubmit={uploadResume} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className={`${labelClass} flex-1`}>Choose resume<input className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 file:px-3 file:py-1.5`} type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} required /></label>
            <button className={buttonClass} disabled={busy || !selectedFile}>Upload resume</button>
          </form>
          <div className="mt-5 space-y-2">{resumes.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No resumes uploaded yet. Upload one to apply and get a match score.</p> : resumes.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"><div className="min-w-0"><p className="break-all font-medium text-slate-900">{r.fileName} {r.isPrimary && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Primary</span>}</p><p className="text-sm text-slate-600">{r.mimeType} · {r.fileSizeBytes ? `${(r.fileSizeBytes / 1024).toFixed(1)} KB` : "seeded text-only resume"} · {formatDate(r.uploadedAt)}</p></div><div className="flex gap-2">{!r.isPrimary && <button className={secondaryClass} disabled={busy} onClick={() => makePrimary(r.id)}>Set as primary</button>}<button className={secondaryClass} disabled={busy} onClick={() => deleteResume(r.id)}>Delete</button></div></div>)}</div>
        </Section>
      </>}
      <p className="pb-4 text-xs text-slate-500">Resume files are private and are not served from a public URL.</p>
  </PageShell>;
}
