"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, Card, dangerClass, EmptyState, errorLines, Icon, inputClass, labelClass, PageHeader, PageShell,
  request, secondaryClass, SkeletonList, tableClass, tableWrapClass, tdClass, theadClass, thClass, trClass,
} from "@/components/ui";

const EMPTY = { name: "", industry: "", location: "", website: "", description: "" };

function CompanyForm({ company, onSaved, onCancel }) {
  const [form, setForm] = useState(company ? {
    name: company.name, industry: company.industry || "", location: company.location || "",
    website: company.website || "", description: company.description || "",
  } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = company
      ? await request(`/api/admin/companies/${company.id}`, { method: "PATCH", json: form })
      : await request("/api/admin/companies", { method: "POST", json: form });
    setBusy(false);
    if (!r.ok) { setError(errorLines(r.body, "The company could not be saved.")); return; }
    onSaved(r.body.company, company ? "updated" : "created");
  }

  return <Card title={company ? `Edit ${company.name}` : "Add a company"}>
    <form onSubmit={submit} className="space-y-4">
      <Alert lines={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Company name<input className={inputClass} value={form.name} onChange={set("name")} required maxLength={150} autoFocus /></label>
        <label className={labelClass}>Industry <span className="font-normal text-slate-400">(optional)</span><input className={inputClass} value={form.industry} onChange={set("industry")} maxLength={120} /></label>
        <label className={labelClass}>Location <span className="font-normal text-slate-400">(optional)</span><input className={inputClass} value={form.location} onChange={set("location")} maxLength={120} placeholder="City, state" /></label>
        <label className={labelClass}>Website <span className="font-normal text-slate-400">(optional)</span><input className={inputClass} type="url" value={form.website} onChange={set("website")} maxLength={255} placeholder="https://example.com" /></label>
        <label className={`${labelClass} sm:col-span-2`}>Description <span className="font-normal text-slate-400">(optional)</span><textarea className={`${inputClass} min-h-20`} value={form.description} onChange={set("description")} maxLength={5000} /></label>
      </div>
      <div className="flex gap-2">
        <button className={buttonClass} disabled={busy}>{busy ? "Saving…" : company ? "Save changes" : "Create company"}</button>
        <button type="button" className={secondaryClass} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  </Card>;
}

export default function CompanyManager() {
  const [companies, setCompanies] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | company
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const r = await request("/api/admin/companies");
    if (r.ok) setCompanies(r.body.companies); else setError(errorLines(r.body, "Companies could not be loaded."));
  }, []);
  useEffect(() => { load(); }, [load]);

  function saved(company, verb) {
    setEditing(null); setError(null);
    setNotice([`${company.name} ${verb}.`]);
    load();
  }

  async function remove(company) {
    setBusyId(company.id); setError(null); setNotice(null);
    const r = await request(`/api/admin/companies/${company.id}`, { method: "DELETE" });
    setBusyId(null); setConfirmId(null);
    // A 409 here is the database refusing (ON DELETE RESTRICT): show its reason.
    if (!r.ok) { setError(errorLines(r.body, "The company could not be deleted.")); return; }
    setNotice([`${company.name} deleted.`]);
    load();
  }

  return <PageShell>
    <PageHeader title="Companies" description="Hiring organisations. A company that still has recruiters or jobs cannot be deleted: the foreign keys use ON DELETE RESTRICT."
      actions={editing !== "new" && <button className={buttonClass} onClick={() => { setEditing("new"); setNotice(null); }}><Icon name="plus" className="h-4 w-4" />Add company</button>} />
    <Alert lines={error} />
    <Alert lines={notice} kind="success" />
    {editing && <CompanyForm key={editing === "new" ? "new" : editing.id} company={editing === "new" ? null : editing} onSaved={saved} onCancel={() => setEditing(null)} />}
    {companies === null ? !error && <SkeletonList rows={3} label="Loading companies" />
      : companies.length === 0 ? <EmptyState icon="building" title="No companies yet" message="Add the first hiring company to get started." />
      : <div className={tableWrapClass}>
        <table className={tableClass}>
          <thead className={theadClass}><tr>
            <th className={thClass}>Company</th><th className={thClass}>Location</th>
            <th className={`${thClass} text-right`}>Recruiters</th><th className={`${thClass} text-right`}>Jobs</th><th className={`${thClass} text-right`}>Applications</th>
            <th className={`${thClass} text-right`}><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>{companies.map((c) => <tr key={c.id} className={trClass}>
            <td className={tdClass}>
              <p className="font-medium text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">{c.industry || "No industry set"}{c.website && <> · <a href={c.website} target="_blank" rel="noreferrer" className="hover:underline">{c.website.replace(/^https?:\/\//, "")}</a></>}</p>
            </td>
            <td className={`${tdClass} text-slate-600`}>{c.location || "—"}</td>
            <td className={`${tdClass} text-right tabular-nums`}>{c.recruiterCount}</td>
            <td className={`${tdClass} text-right tabular-nums`}>{c.jobCount}<span className="text-slate-400"> · {c.openJobCount} open</span></td>
            <td className={`${tdClass} text-right tabular-nums`}>{c.applicationCount}</td>
            <td className={`${tdClass} text-right`}>
              {confirmId === c.id
                ? <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                  <span className="text-xs text-slate-600">Delete {c.name}?</span>
                  <button className={dangerClass} disabled={busyId === c.id} onClick={() => remove(c)}>{busyId === c.id ? "Deleting…" : "Delete"}</button>
                  <button className={secondaryClass} onClick={() => setConfirmId(null)}>Keep</button>
                </div>
                : <div className="flex justify-end gap-2">
                  <button className={secondaryClass} onClick={() => { setEditing(c); setNotice(null); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Edit ${c.name}`}><Icon name="pencil" className="h-4 w-4" />Edit</button>
                  <button className={dangerClass} onClick={() => setConfirmId(c.id)} aria-label={`Delete ${c.name}`}><Icon name="trash" className="h-4 w-4" />Delete</button>
                </div>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
  </PageShell>;
}
