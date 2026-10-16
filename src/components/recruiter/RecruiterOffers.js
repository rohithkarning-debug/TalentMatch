"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, dangerClass, EmptyState, errorLines, formatDate, formatDateTime, formatMoney, linkClass, PageHeader, PageShell, request, SkeletonList, StatusBadge, tableClass, tableWrapClass, tdClass, thClass, theadClass, trClass,
} from "@/components/ui";

export default function RecruiterOffers() {
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const load = useCallback(async () => {
    const r = await request("/api/recruiter/offers");
    if (r.ok) setOffers(r.body.offers); else setError(errorLines(r.body, "Offers could not be loaded."));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function withdraw(offer) {
    if (!window.confirm(`Withdraw the offer to ${offer.candidateName}? Their application will be marked rejected.`)) return;
    setBusyId(offer.id); setError(null);
    const r = await request(`/api/recruiter/offers/${offer.id}/withdraw`, { method: "POST" });
    setBusyId(null);
    if (!r.ok) setError(errorLines(r.body, "Offer could not be withdrawn."));
    load();
  }

  return <PageShell>
      <PageHeader title="Offers" description="One offer per application (UNIQUE constraint). Make offers from a job's applicant list once the candidate is interviewed." />
      <Alert lines={error} />
      {offers === null ? !error && <SkeletonList label="Loading offers" />
        : offers.length === 0 ? <EmptyState icon="gift" title="No offers yet" message="Make an offer from an interviewed applicant on the job page." />
        : <div className={tableWrapClass}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr><th className={thClass}>Candidate</th><th className={thClass}>Job</th><th className={thClass}>Salary</th><th className={thClass}>Joining</th><th className={thClass}>Respond by</th><th className={thClass}>Status</th><th className={thClass}><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>{offers.map((o) => <tr key={o.id} className={trClass}>
              <td className={`${tdClass} font-medium text-slate-900`}>{o.candidateName}</td>
              <td className={tdClass}><Link href={`/recruiter/jobs/${o.jobId}`} className={linkClass}>{o.jobTitle}</Link></td>
              <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatMoney(o.salaryOffered, o.currency)}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{formatDate(o.joiningDate)}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{o.expiresOn ? formatDate(o.expiresOn) : "—"}{o.status === "pending" && o.isExpired && <span className="ml-1 text-xs text-red-600">expired</span>}</td>
              <td className={tdClass}><StatusBadge status={o.status} />{o.respondedAt && <p className="text-xs text-slate-500">{formatDateTime(o.respondedAt)}</p>}</td>
              <td className={`${tdClass} text-right`}>{o.status === "pending" && <button className={dangerClass} disabled={busyId === o.id} onClick={() => withdraw(o)}>Withdraw</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
  </PageShell>;
}
