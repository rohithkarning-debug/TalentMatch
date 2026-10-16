"use client";

// Small shared UI helpers for the recruiter and application pages
// (plain Tailwind class strings, a fetch wrapper, and a few formatters).

import Link from "next/link";
import { useEffect, useState } from "react";

export const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
export const buttonClass = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
export const secondaryClass = "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
export const dangerClass = "rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950";
export const labelClass = "block text-sm font-medium text-zinc-800 dark:text-zinc-200";
export const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";
export const pageClass = "min-h-screen bg-zinc-50 px-4 py-8 dark:bg-black sm:px-6 lg:px-8";

// fetch() that never throws: { ok, status, body }. `json` is sent as JSON.
export async function request(url, { json, ...options } = {}) {
  const init = { credentials: "same-origin", cache: "no-store", ...options };
  if (json !== undefined) {
    init.headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    init.body = JSON.stringify(json);
  }
  try {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: { message: "Network error. Check that the server is running." } } };
  }
}

// Turn an API error body into readable lines (zod field errors included).
export function errorLines(body, fallback) {
  const err = body?.error;
  const lines = [err?.message || fallback];
  const fields = err?.details?.fieldErrors;
  if (fields) for (const [field, messages] of Object.entries(fields)) lines.push(`${field}: ${messages.join(", ")}`);
  for (const message of err?.details?.formErrors || []) lines.push(message);
  if (err?.details?.hint) lines.push(err.details.hint);
  if (err?.details?.constraint) lines.push(`Database rule: ${err.details.constraint}`);
  return lines;
}

export function Alert({ lines, kind = "error" }) {
  if (!lines?.length) return null;
  const style = kind === "error"
    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${style}`}>
    <p className="font-medium">{lines[0]}</p>
    {lines.length > 1 && <ul className="mt-1 list-disc pl-5">{lines.slice(1).map((l) => <li key={l}>{l}</li>)}</ul>}
  </div>;
}

export const STATUS_STYLES = {
  applied: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  shortlisted: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  interviewed: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  offered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  draft: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  open: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  closed: "bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  // interviews
  scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  no_show: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  // offers
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  declined: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  withdrawn: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function StatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] || ""}`}>{status.replace("_", " ")}</span>;
}

export const formatMoney = (amount, currency = "INR") =>
  `${currency === "INR" ? "₹" : `${currency} `}${Number(amount).toLocaleString("en-IN")}`;

// "2026-11-16" -> "16 Nov 2026" without time-zone shifts (a DATE has no time).
export const formatDate = (isoDate) => new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  .toLocaleDateString("en-IN", { timeZone: "UTC", dateStyle: "medium" });

// Notifications link with the unread count, for page headers.
export function NotificationsLink() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    request("/api/notifications?unreadOnly=true&limit=1").then((r) => { if (r.ok) setCount(r.body.unreadCount); });
  }, []);
  return <Link href="/notifications" className={secondaryClass}>
    Notifications{count ? <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">{count}</span> : null}
  </Link>;
}

// Similarity is a cosine in [-1, 1]; null means "not computed yet".
export const formatScore = (score) => (score == null ? "not scored" : score.toFixed(4));

export const EMPLOYMENT_LABELS = { full_time: "Full time", part_time: "Part time", contract: "Contract", internship: "Internship" };

export function formatSalary(job) {
  if (job.salaryMin == null && job.salaryMax == null) return "Salary not disclosed";
  const lakh = (v) => `${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  const range = [job.salaryMin, job.salaryMax].filter((v) => v != null).map(lakh).join(" – ");
  return `${job.currency === "INR" ? "₹" : `${job.currency} `}${range} per year`;
}

export const formatDateTime = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

// Vertical status timeline built from application_status_history rows.
export function StatusTimeline({ history }) {
  return <ol className="relative ml-2 border-l border-zinc-200 dark:border-zinc-800">
    {history.map((h, i) => <li key={i} className="mb-3 ml-4 last:mb-0">
      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-zinc-400 dark:border-zinc-950" />
      <p className="text-sm text-zinc-800 dark:text-zinc-200">
        {h.oldStatus ? <><span className="capitalize">{h.oldStatus}</span> → </> : null}
        <StatusBadge status={h.newStatus} />
        <span className="ml-2 text-xs text-zinc-500">{formatDateTime(h.changedAt)}{h.changedBy ? ` · ${h.changedBy}` : ""}</span>
      </p>
      {h.note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{h.note}</p>}
    </li>)}
  </ol>;
}
