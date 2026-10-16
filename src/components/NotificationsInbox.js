"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, cardClass, EmptyState, errorLines, formatDateTime, mutedLabelClass, NOTIFICATIONS_CHANGED, PageHeader, PageShell, request, secondaryClass, SkeletonList,
} from "@/components/ui";

const TYPE_LABELS = {
  application_submitted: "Application", status_changed: "Status", interview_scheduled: "Interview",
  interview_updated: "Interview", offer_made: "Offer", offer_responded: "Offer", offer_withdrawn: "Offer", system: "System",
};

// Inbox for every role. The API only ever returns the session user's rows.
export default function NotificationsInbox() {
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
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    load();
  }
  async function markAll() {
    const r = await request("/api/notifications/read-all", { method: "POST" });
    if (!r.ok) setError(errorLines(r.body, "Could not mark all as read."));
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    load();
  }

  return <PageShell>
      <PageHeader title="Notifications" description={data ? `${data.unreadCount} unread` : "Updates about applications, interviews and offers."}
        actions={<div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input className="h-4 w-4 rounded border-slate-300 accent-indigo-600" type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
          <button className={secondaryClass} onClick={markAll} disabled={!data?.unreadCount}>Mark all as read</button>
        </div>} />
      <Alert lines={error} />
      {data === null ? !error && <SkeletonList label="Loading notifications" />
        : data.notifications.length === 0 ? <EmptyState icon="bell" title={unreadOnly ? "No unread notifications" : "No notifications yet"} message="You'll be notified about applications, interviews and offers." />
        : <ul className="space-y-2">{data.notifications.map((n) => <li key={n.id}
            className={`${cardClass} flex items-start justify-between gap-4 ${n.isRead ? "bg-white/70" : "border-l-4 border-l-indigo-500"}`}>
          <div>
            <p className={mutedLabelClass}>{TYPE_LABELS[n.type] || n.type} · {formatDateTime(n.createdAt)}</p>
            <p className={`mt-1 text-slate-900 ${n.isRead ? "text-slate-600" : "font-semibold"}`}>{n.title}</p>
            <p className="text-sm text-slate-700">{n.message}</p>
          </div>
          {!n.isRead && <button className={`${secondaryClass} shrink-0`} onClick={() => markRead(n.id)}>Mark read</button>}
        </li>)}</ul>}
  </PageShell>;
}
