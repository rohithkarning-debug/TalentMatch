"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Alert, buttonClass, cardClass, dangerClass, errorLines, formatDate, formatDateTime, formatMoney,
  NotificationsLink, pageClass, request, secondaryClass, StatusBadge,
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

  return <main className={pageClass}>
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex gap-4 text-sm"><Link href="/candidate" className="text-zinc-500 hover:underline">← Candidate dashboard</Link><Link href="/candidate/applications" className="text-zinc-500 hover:underline">My applications</Link></div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">My offers</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Accept or decline before the respond-by date (valid until the end of that day, India time).</p>
        </div>
        <div className="flex gap-2"><Link href="/candidate/interviews" className={secondaryClass}>My interviews</Link><NotificationsLink /></div>
      </header>
      <Alert lines={message} kind="success" />
      <Alert lines={error} />
      {offers === null ? !error && <p className="text-sm text-zinc-500">Loading offers…</p>
        : offers.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>No offers yet.</p>
        : <ul className="space-y-3">{offers.map((o) => <li key={o.id} className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                <Link href={`/candidate/jobs/${o.jobId}`} className="hover:underline">{o.jobTitle}</Link> <StatusBadge status={o.status} />
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.company} · {o.location} · offered {formatDateTime(o.offeredAt)}</p>
              <p className="mt-2 font-mono text-xl text-zinc-900 dark:text-zinc-50">{formatMoney(o.salaryOffered, o.currency)} <span className="font-sans text-sm text-zinc-500">per year</span></p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">Joining {formatDate(o.joiningDate)} · respond by {o.expiresOn ? formatDate(o.expiresOn) : "no deadline"}
                {o.status === "pending" && o.isExpired && <span className="ml-2 font-medium text-red-600">expired</span>}</p>
              {o.respondedAt && <p className="text-xs text-zinc-500">You responded {formatDateTime(o.respondedAt)}</p>}
            </div>
            {o.canRespond && <div className="flex gap-2">
              <button className={buttonClass} disabled={busyId === o.id} onClick={() => respond(o, "accept")}>Accept</button>
              <button className={dangerClass} disabled={busyId === o.id} onClick={() => respond(o, "decline")}>Decline</button>
            </div>}
          </div>
        </li>)}</ul>}
    </div>
  </main>;
}
