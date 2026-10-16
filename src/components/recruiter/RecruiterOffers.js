"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, cardClass, dangerClass, errorLines, formatDate, formatDateTime, formatMoney,
  NotificationsLink, pageClass, request, secondaryClass, StatusBadge,
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

  return <main className={pageClass}>
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/recruiter" className="text-sm text-zinc-500 hover:underline">← My jobs</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Offers</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">One offer per application (UNIQUE constraint). Make offers from a job&apos;s applicant list once the candidate is interviewed.</p>
        </div>
        <div className="flex gap-2"><Link href="/recruiter/interviews" className={secondaryClass}>Interviews</Link><NotificationsLink /></div>
      </header>
      <Alert lines={error} />
      {offers === null ? !error && <p className="text-sm text-zinc-500">Loading offers…</p>
        : offers.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No offers yet.</p>
        : <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr><th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Job</th><th className="px-4 py-2">Salary</th><th className="px-4 py-2">Joining</th><th className="px-4 py-2">Respond by</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody>{offers.map((o) => <tr key={o.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{o.candidateName}</td>
              <td className="px-4 py-3"><Link href={`/recruiter/jobs/${o.jobId}`} className="hover:underline">{o.jobTitle}</Link></td>
              <td className="px-4 py-3 font-mono">{formatMoney(o.salaryOffered, o.currency)}</td>
              <td className="px-4 py-3">{formatDate(o.joiningDate)}</td>
              <td className="px-4 py-3">{o.expiresOn ? formatDate(o.expiresOn) : "—"}{o.status === "pending" && o.isExpired && <span className="ml-1 text-xs text-red-600">expired</span>}</td>
              <td className="px-4 py-3"><StatusBadge status={o.status} />{o.respondedAt && <p className="text-xs text-zinc-500">{formatDateTime(o.respondedAt)}</p>}</td>
              <td className="px-4 py-3 text-right">{o.status === "pending" && <button className={dangerClass} disabled={busyId === o.id} onClick={() => withdraw(o)}>Withdraw</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </div>
  </main>;
}
