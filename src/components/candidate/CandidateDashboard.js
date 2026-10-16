"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NotificationsLink } from "@/components/ui";

const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const buttonClass = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const secondaryClass = "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

async function request(url, options = {}) {
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: { message: "Network error. Check that the server is running." } } };
  }
}

function Section({ title, description, children }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6"><div className="mb-5"><h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>{description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}</div>{children}</section>;
}

function Field({ label, name, value, onChange, type = "text", ...props }) {
  return <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}<input className={inputClass} name={name} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...props} /></label>;
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

  return <main className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-black sm:px-6 lg:px-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><Link href="/" className="text-sm text-zinc-500 hover:underline">← TalentMatch home</Link><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Candidate dashboard</h1><p className="mt-2 text-zinc-600 dark:text-zinc-400">Manage your profile, skills, and resumes.</p></div>
        <div className="flex flex-wrap gap-2"><Link href="/candidate/jobs" className={secondaryClass}>Browse open jobs →</Link><Link href="/candidate/applications" className={secondaryClass}>My applications →</Link><Link href="/candidate/interviews" className={secondaryClass}>Interviews</Link><Link href="/candidate/offers" className={secondaryClass}>Offers</Link><NotificationsLink /><button className={secondaryClass} onClick={refresh} disabled={busy}>Refresh data</button></div>
      </header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{notice}</div>}
      {!profile ? <p className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800">Loading your profile…</p> : <>
        <Section title="My profile" description="Your name and profile information are saved to the TalentMatch database.">
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" value={profile.fullName} onChange={(v) => updateProfileField("fullName", v)} required minLength={2} maxLength={120} />
              <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">Email<input className={`${inputClass} opacity-70`} value={profile.email} readOnly /></label>
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
            <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 sm:col-span-2">Skill<select className={inputClass} value={skillId} onChange={(e) => setSkillId(e.target.value)} required><option value="">Choose a skill…</option>{availableSkills.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.category}</option>)}</select></label>
            <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">Proficiency<select className={inputClass} value={proficiency} onChange={(e) => setProficiency(e.target.value)}>{[[1,"Beginner"],[2,"Basic"],[3,"Intermediate"],[4,"Advanced"],[5,"Expert"]].map(([v,t]) => <option key={v} value={v}>{v} — {t}</option>)}</select></label>
            <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">Years used<input className={inputClass} type="number" min="0" max="60" step="0.5" value={yearsUsed} onChange={(e) => setYearsUsed(e.target.value)} required /></label>
            <div className="sm:col-span-4"><button className={buttonClass} disabled={busy || !availableSkills.length}>{availableSkills.length ? "Add skill" : "All catalogue skills added"}</button></div>
          </form>
          <div className="mt-5 space-y-2">{skills.length === 0 ? <p className="text-sm text-zinc-500">You haven't added any skills yet.</p> : skills.map((s) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><div><p className="font-medium text-zinc-900 dark:text-zinc-50">{s.name} <span className="text-xs font-normal text-zinc-500">· {s.category}</span></p><p className="text-sm text-zinc-600 dark:text-zinc-400">Proficiency {s.proficiency}/5 · {s.yearsUsed} years</p></div><button className={secondaryClass} disabled={busy} onClick={() => removeSkill(s.id)}>Remove</button></div>)}</div>
        </Section>
        <Section title="My resumes" description="PDF and plain-text resumes up to 5 MB. Text must be extractable for this module to save it.">
          <form onSubmit={uploadResume} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">Choose resume<input className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 dark:file:bg-zinc-700`} type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} required /></label>
            <button className={buttonClass} disabled={busy || !selectedFile}>Upload resume</button>
          </form>
          <div className="mt-5 space-y-2">{resumes.length === 0 ? <p className="text-sm text-zinc-500">No resumes uploaded yet.</p> : resumes.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><div className="min-w-0"><p className="break-all font-medium text-zinc-900 dark:text-zinc-50">{r.fileName} {r.isPrimary && <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Primary</span>}</p><p className="text-sm text-zinc-600 dark:text-zinc-400">{r.mimeType} · {r.fileSizeBytes ? `${(r.fileSizeBytes / 1024).toFixed(1)} KB` : "seeded text-only resume"} · {new Date(r.uploadedAt).toLocaleDateString()}</p></div><div className="flex gap-2">{!r.isPrimary && <button className={secondaryClass} disabled={busy} onClick={() => makePrimary(r.id)}>Set as primary</button>}<button className={secondaryClass} disabled={busy} onClick={() => deleteResume(r.id)}>Delete</button></div></div>)}</div>
        </Section>
      </>}
      <p className="pb-4 text-xs text-zinc-500">Resume files are private and are not served from a public URL.</p>
    </div>
  </main>;
}
