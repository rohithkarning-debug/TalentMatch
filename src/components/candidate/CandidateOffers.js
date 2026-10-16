"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, dangerClass, EmptyState, errorLines, formatDate, formatDateTime, formatMoney, PageHeader, PageShell, request, SkeletonList, StatusBadge,
} from "@/components/ui";

export default function CandidateOffers() {
  const [offers, setOffers] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const load = useCallback(async () => {
    const r = await request("/api/candidate/offers");
    if (r.ok) setOffers(r.body.offers); else setError(errorLines(r.body, "Offers could not be loaded."));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function respond(offer, decision) {
    if (!window.confirm(`${decision === "accept" ? "Accept" : "Decline"} the offer for ${offer.jobTitle}? This cannot be undone.`)) return;
    setBusyId(offer.id); setError(null); setMessage(null);
    const r = await request(`/api/candidate/offers/${offer.id}/respond`, { method: "POST", json: { decision } });
    setBusyId(null);
    if (r.ok) setMessage([`Offer ${r.body.offer.status}. The recruiter has been notified.`]);
    else setError(errorLines(r.body, "Your response could not be saved."));
    load();
  }

  return <PageShell>
      <PageHeader title="My offers" description="Accept or decline before the respond-by date (valid until the end of that day, India time)." />
      <Alert lines={message} kind="success" />
      <Alert lines={error} />
      {offers === null ? !error && <SkeletonList label="Loading offers" />
        : offers.length === 0 ? <EmptyState icon="gift" title="No offers yet" message="Offers from recruiters appear here once you have been interviewed." />
        : <ul className="space-y-3">{offers.map((o) => <li key={o.id} className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                <Link href={`/candidate/jobs/${o.jobId}`} className="hover:underline">{o.jobTitle}</Link> <StatusBadge status={o.status} />
              </h2>
              <p className="text-sm text-slate-600">{o.company} · {o.location} · offered {formatDateTime(o.offeredAt)}</p>
              <p className="mt-2 font-mono text-xl text-slate-900">{formatMoney(o.salaryOffered, o.currency)} <span className="font-sans text-sm text-slate-500">per year</span></p>
              <p className="text-sm text-slate-700">Joining {formatDate(o.joiningDate)} · respond by {o.expiresOn ? formatDate(o.expiresOn) : "no deadline"}
                {o.status === "pending" && o.isExpired && <span className="ml-2 font-medium text-red-600">expired</span>}</p>
              {o.respondedAt && <p className="text-xs text-slate-500">You responded {formatDateTime(o.respondedAt)}</p>}
            </div>
            {o.canRespond && <div className="flex gap-2">
              <button className={buttonClass} disabled={busyId === o.id} onClick={() => respond(o, "accept")}>Accept</button>
              <button className={dangerClass} disabled={busyId === o.id} onClick={() => respond(o, "decline")}>Decline</button>
            </div>}
          </div>
        </li>)}</ul>}
  </PageShell>;
}
