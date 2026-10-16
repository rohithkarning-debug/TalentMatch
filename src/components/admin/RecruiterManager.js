"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, Card, dangerClass, EmptyState, errorLines, formatDateTime, Icon, inputClass, labelClass, PageHeader,
  PageShell, request, secondaryClass, SkeletonList, StatusBadge, tableClass, tableWrapClass, tdClass, theadClass, thClass, trClass,
} from "@/components/ui";

function RecruiterForm({ recruiter, companies, onSaved, onCancel }) {
  const isNew = !recruiter;
  const [form, setForm] = useState({
    fullName: recruiter?.fullName || "", email: "", password: "",
    companyId: String(recruiter?.companyId || companies[0]?.id || ""),
    designation: recruiter?.designation || "", phone: recruiter?.phone || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const common = { fullName: form.fullName, companyId: Number(form.companyId), designation: form.designation, phone: form.phone };
    const r = isNew
      ? await request("/api/admin/recruiters", { method: "POST", json: { ...common, email: form.email, password: form.password } })
      : await request(`/api/admin/recruiters/${recruiter.id}`, { method: "PATCH", json: common });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "The recruiter could not be saved.")); return; }
    onSaved(r.body.recruiter, isNew ? "created" : "updated");
  }

  return <Card title={isNew ? "Create a recruiter account" : `Edit ${recruiter.fullName}`}
    description={isNew ? "Creates the login (users) and the recruiter profile (recruiters) in one transaction. The password is stored only as a bcrypt hash." : undefined}>
    <form onSubmit={submit} className="space-y-4">
      <Alert lines={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Full name<input className={inputClass} value={form.fullName} onChange={set("fullName")} required minLength={2} maxLength={120} autoFocus /></label>
        {isNew ? <label className={labelClass}>Work email<input className={inputClass} type="email" autoComplete="off" value={form.email} onChange={set("email")} required maxLength={255} /></label>
          : <label className={labelClass}>Work email<input className={inputClass} value={recruiter.email} disabled /></label>}
        {isNew && <label className={labelClass}>Temporary password
          <input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} required minLength={8} maxLength={72} aria-describedby="pw-hint" />
          <span id="pw-hint" className="mt-1 block text-xs font-normal text-slate-500">At least 8 characters with a letter and a number.</span>
        </label>}
        <label className={labelClass}>Company<select className={inputClass} value={form.companyId} onChange={set("companyId")} required>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className={labelClass}>Designation <span className="font-normal text-slate-400">(optional)</span><input className={inputClass} value={form.designation} onChange={set("designation")} maxLength={80} placeholder="e.g. Talent Acquisition Lead" /></label>
        <label className={labelClass}>Phone <span className="font-normal text-slate-400">(optional)</span><input className={inputClass} type="tel" value={form.phone} onChange={set("phone")} maxLength={20} placeholder="+91 98765 43210" /></label>
      </div>
      <div className="flex gap-2">
        <button className={buttonClass} disabled={busy || !companies.length}>{busy ? "Saving…" : isNew ? "Create recruiter" : "Save changes"}</button>
        <button type="button" className={secondaryClass} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </Card>;
}

export default function RecruiterManager() {
  const [recruiters, setRecruiters] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | recruiter
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([request("/api/admin/recruiters"), request("/api/admin/companies")]);
    if (!r.ok || !c.ok) { setError(errorLines((r.ok ? c : r).body, "Recruiters could not be loaded.")); return; }
    setRecruiters(r.body.recruiters); setCompanies(c.body.companies);
  }, []);
  useEffect(() => { load(); }, [load]);

  function saved(recruiter, verb) {
    setEditing(null); setError(null);
    setNotice([`${recruiter.fullName} ${verb}.`]);
    load();
  }

  async function toggleActive(rec) {
    setBusyId(rec.id); setError(null); setNotice(null);
    const r = await request(`/api/admin/recruiters/${rec.id}`, { method: "PATCH", json: { isActive: !rec.isActive } });
    setBusyId(null);
    if (!r.ok) { setError(errorLines(r.body, "The account could not be updated.")); return; }
    setNotice([rec.isActive
      ? `${rec.fullName} deactivated. They can no longer sign in, and their current session stops working on the next request.`
      : `${rec.fullName} reactivated.`]);
    load();
  }

  const activeCount = recruiters?.filter((r) => r.isActive).length ?? 0;

  return <PageShell>
    <PageHeader title="Recruiters"
      description={recruiters ? `${recruiters.length} recruiter accounts, ${activeCount} active. Deactivated accounts keep their jobs and history but cannot sign in.` : "Recruiter accounts and the company each one hires for."}
      actions={editing !== "new" && <button className={buttonClass} disabled={!companies.length} onClick={() => { setEditing("new"); setNotice(null); }}><Icon name="plus" className="h-4 w-4" />New recruiter</button>} />
    <Alert lines={error} />
    <Alert lines={notice} kind="success" />
    {editing && <RecruiterForm key={editing === "new" ? "new" : editing.id} recruiter={editing === "new" ? null : editing} companies={companies}
      onSaved={saved} onCancel={() => setEditing(null)} />}
    {recruiters === null ? !error && <SkeletonList rows={4} label="Loading recruiters" />
      : recruiters.length === 0 ? <EmptyState icon="user" title="No recruiters yet" message={companies.length ? "Create the first recruiter account." : "Add a company first, then create recruiters for it."} />
      : <div className={tableWrapClass}>
        <table className={`${tableClass} min-w-[760px]`}>
          <thead className={theadClass}><tr>
            <th className={thClass}>Recruiter</th><th className={thClass}>Company</th>
            <th className={`${thClass} text-right`}>Jobs</th><th className={`${thClass} text-right`}>In pipeline</th>
            <th className={thClass}>Last sign-in</th><th className={thClass}>Status</th><th className={thClass}><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>{recruiters.map((r) => <tr key={r.id} className={`${trClass} ${r.isActive ? "" : "text-slate-500"}`}>
            <td className={tdClass}>
              <p className={`font-medium ${r.isActive ? "text-slate-900" : "text-slate-500"}`}>{r.fullName}</p>
              <p className="text-xs text-slate-500">{r.email}</p>
            </td>
            <td className={`${tdClass} min-w-[11rem]`}><p>{r.companyName}</p><p className="text-xs text-slate-500">{r.designation || "—"}</p></td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{r.jobCount}<span className="text-slate-400"> · {r.openJobCount} open</span></td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`} title="Applications still applied, shortlisted or interviewed (recruiter_pipeline_view)">{r.activeInPipeline}</td>
            <td className={`${tdClass} whitespace-nowrap text-slate-600`}>{r.lastLoginAt ? formatDateTime(r.lastLoginAt) : "Never"}</td>
            <td className={tdClass}><StatusBadge status={r.isActive ? "active" : "inactive"} /></td>
            <td className={tdClass}>
              <div className="flex justify-end gap-2 whitespace-nowrap">
                <button className={secondaryClass} onClick={() => { setEditing(r); setNotice(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Edit ${r.fullName}`}><Icon name="pencil" className="h-4 w-4" />Edit</button>
                <button className={r.isActive ? dangerClass : secondaryClass} disabled={busyId === r.id} onClick={() => toggleActive(r)}>
                  {busyId === r.id ? "Saving…" : r.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
  </PageShell>;
}
