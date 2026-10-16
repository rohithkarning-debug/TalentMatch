"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, cardClass, errorLines, formatDateTime, pageClass, request, secondaryClass } from "@/components/ui";

const HOME = { admin: "/", recruiter: "/recruiter", candidate: "/candidate" };
const TYPE_LABELS = {
  application_submitted: "Application", status_changed: "Status", interview_scheduled: "Interview",
  interview_updated: "Interview", offer_made: "Offer", offer_responded: "Offer", offer_withdrawn: "Offer", system: "System",
};

// Inbox for every role. The API only ever returns the session user's rows.
export default function NotificationsInbox({ role }) {
  const [data, setData] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    const r = await request(`/api/notifications?unreadOnly=${unreadOnly}`);
    if (r.ok) { setData(r.body); setError(null); } else setError(errorLines(r.body, "Notifications could not be loaded."));
  }, [unreadOnly]);
  useEffect(() => { load(); }, [load]);

  async function markRead(id) {
    const r = await request(`/api/notifications/${id}`, { method: "PATCH", json: { isRead: true } });
    if (!r.ok) setError(errorLines(r.body, "Could not mark as read."));
    load();
  }
  async function markAll() {
    const r = await request("/api/notifications/read-all", { method: "POST" });
    if (!r.ok) setError(errorLines(r.body, "Could not mark all as read."));
    load();
  }

  return <main className={pageClass}>
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={HOME[role] || "/"} className="text-sm text-zinc-500 hover:underline">← Back to dashboard</Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Notifications</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">{data ? `${data.unreadCount} unread` : " "}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
          <button className={secondaryClass} onClick={markAll} disabled={!data?.unreadCount}>Mark all as read</button>
        </div>
      </header>
      <Alert lines={error} />
      {data === null ? !error && <p className="text-sm text-zinc-500">Loading notifications…</p>
        : data.notifications.length === 0 ? <p className={`${cardClass} text-sm text-zinc-500`}>{unreadOnly ? "No unread notifications." : "No notifications yet."}</p>
        : <ul className="space-y-2">{data.notifications.map((n) => <li key={n.id}
            className={`${cardClass} flex items-start justify-between gap-4 ${n.isRead ? "opacity-70" : "border-l-4 border-l-sky-500"}`}>
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{TYPE_LABELS[n.type] || n.type} · {formatDateTime(n.createdAt)}</p>
            <p className={`mt-1 text-zinc-900 dark:text-zinc-50 ${n.isRead ? "" : "font-semibold"}`}>{n.title}</p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{n.message}</p>
          </div>
          {!n.isRead && <button className={`${secondaryClass} shrink-0`} onClick={() => markRead(n.id)}>Mark read</button>}
        </li>)}</ul>}
    </div>
  </main>;
}
