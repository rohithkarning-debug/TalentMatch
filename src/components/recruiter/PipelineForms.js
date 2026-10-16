"use client";

import { useState } from "react";
import { z } from "zod";
import { Alert, buttonClass, errorLines, inputClass, labelClass, request, secondaryClass } from "@/components/ui";
import { INTERVIEW_MODES, interviewScheduleSchema, offerCreateSchema, todayInIndia } from "@/lib/validation/pipeline";

// <input type="datetime-local"> gives "2026-10-20T10:00" in the browser's
// time zone; toISOString() turns it into an unambiguous UTC timestamp.
export const localInputToIso = (value) => (value ? new Date(value).toISOString() : "");

// Errors from the zod schema shown before anything is sent (the API runs the
// same schema again, and the database has the final say).
function clientErrors(result) {
  const { fieldErrors, formErrors } = z.flattenError(result.error);
  return ["Please fix the form.", ...Object.entries(fieldErrors).map(([f, m]) => `${f}: ${m.join(", ")}`), ...formErrors];
}

export function ScheduleInterviewForm({ applicationId, isFirst, onDone, onCancel }) {
  const [form, setForm] = useState({ scheduledAt: "", durationMinutes: "45", mode: "video", locationOrLink: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const body = { ...form, scheduledAt: localInputToIso(form.scheduledAt), locationOrLink: form.locationOrLink.trim() || null };
    const parsed = interviewScheduleSchema.safeParse(body);
    if (!parsed.success) { setError(clientErrors(parsed)); return; }
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/applications/${applicationId}/interviews`, { method: "POST", json: body });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "Interview could not be scheduled.")); return; }
    onDone(r.body);
  }

  return <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Schedule interview{isFirst && <span className="ml-2 text-xs font-normal text-zinc-500">first round: the application moves to “interviewed” in the same transaction</span>}</p>
    <div className="grid gap-3 sm:grid-cols-4">
      <label className={`${labelClass} sm:col-span-2`}>Date and time
        <input type="datetime-local" required className={inputClass} value={form.scheduledAt} onChange={set("scheduledAt")} /></label>
      <label className={labelClass}>Duration (min)
        <input type="number" min={15} max={480} step={15} className={inputClass} value={form.durationMinutes} onChange={set("durationMinutes")} /></label>
      <label className={labelClass}>Mode
        <select className={inputClass} value={form.mode} onChange={set("mode")}>{INTERVIEW_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
    </div>
    <label className={labelClass}>{form.mode === "video" ? "Meeting link" : form.mode === "onsite" ? "Location" : "Phone details (optional)"}
      <input className={inputClass} value={form.locationOrLink} onChange={set("locationOrLink")} maxLength={500}
        placeholder={form.mode === "video" ? "https://meet.example/…" : form.mode === "onsite" ? "Office address" : ""} /></label>
    <Alert lines={error} />
    <div className="flex gap-2">
      <button className={buttonClass} disabled={busy}>{busy ? "Scheduling…" : "Schedule"}</button>
      <button type="button" className={secondaryClass} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export function MakeOfferForm({ applicationId, onDone, onCancel }) {
  const [form, setForm] = useState({ salaryOffered: "", currency: "INR", joiningDate: "", expiresOn: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const parsed = offerCreateSchema.safeParse(form);
    if (!parsed.success) { setError(clientErrors(parsed)); return; }
    setBusy(true); setError(null);
    const r = await request(`/api/recruiter/applications/${applicationId}/offer`, { method: "POST", json: form });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "Offer could not be made.")); return; }
    onDone(r.body);
  }

  return <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Make an offer <span className="ml-2 text-xs font-normal text-zinc-500">one transaction: offer + status “offered” + candidate notification</span></p>
    <div className="grid gap-3 sm:grid-cols-4">
      <label className={labelClass}>Annual salary
        <input type="number" min={1} step="any" required className={inputClass} value={form.salaryOffered} onChange={set("salaryOffered")} placeholder="2400000" /></label>
      <label className={labelClass}>Currency
        <input className={inputClass} value={form.currency} onChange={set("currency")} maxLength={3} /></label>
      <label className={labelClass}>Joining date
        <input type="date" required min={todayInIndia()} className={inputClass} value={form.joiningDate} onChange={set("joiningDate")} /></label>
      <label className={labelClass}>Respond by
        <input type="date" required min={todayInIndia()} max={form.joiningDate || undefined} className={inputClass} value={form.expiresOn} onChange={set("expiresOn")} /></label>
    </div>
    <Alert lines={error} />
    <div className="flex gap-2">
      <button className={buttonClass} disabled={busy}>{busy ? "Sending…" : "Send offer"}</button>
      <button type="button" className={secondaryClass} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
