"use client";

// Shared design system for every page (candidate, recruiter, admin):
// Tailwind class tokens, layout pieces (PageHeader, Card, EmptyState,
// skeletons), status pills, icons, a fetch wrapper and formatters.
//
// Design rules, kept in one place so pages stay consistent:
//   - off-white page (slate-50 = #F6F9FC), white cards with a hairline
//     border and a soft layered shadow (shadow-card), 16px radius
//   - ONE accent colour (indigo = #635BFF, see globals.css) for primary
//     buttons, links, focus rings, bars; navy (slate-900) for text
//   - type scale: page title 3xl/4xl tight tracking, section title
//     base/semibold, muted labels xs/uppercase, body sm; numbers tabular
//   - status colours mean the same thing everywhere (STATUS_STYLES)

import { useEffect, useId, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/format-date";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
// Small upward lift on hover; no movement for people who prefer reduced motion.
const lift = "transition duration-150 ease-out hover:-translate-y-px motion-reduce:hover:translate-y-0";

const fieldBase = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[0_1px_1px_rgb(10_37_64/0.04)] placeholder:text-slate-400 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15";
export const inputClass = `mt-1 block w-full ${fieldBase} disabled:bg-slate-50 disabled:text-slate-500`;
// Same look without "block w-full mt-1", for controls that sit in a row and set their own width.
export const inlineInputClass = fieldBase;
export const buttonClass = `group inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgb(10_37_64/0.15)] hover:bg-indigo-700 hover:shadow-[0_4px_12px_-2px_rgb(99_91_255/0.45)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${lift} ${focusRing}`;
export const secondaryClass = `inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-[0_1px_2px_rgb(10_37_64/0.06)] hover:border-slate-300 hover:text-slate-900 hover:shadow-[0_3px_8px_-2px_rgb(10_37_64/0.12)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${lift} ${focusRing}`;
export const dangerClass = `inline-flex items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 shadow-[0_1px_2px_rgb(10_37_64/0.06)] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${lift} ${focusRing}`;
export const labelClass = "block text-sm font-medium text-slate-700";
export const cardClass = "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-7";
export const pageClass = "px-4 py-8 sm:px-6 sm:py-10 lg:px-8";
export const linkClass = `rounded font-semibold text-indigo-600 hover:text-indigo-800 ${focusRing}`;
export const mutedLabelClass = "text-xs font-semibold uppercase tracking-wider text-slate-500";
export const sectionTitleClass = "text-base font-semibold tracking-tight text-slate-900";
export const tableWrapClass = "relative overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-card";
export const tableClass = "w-full min-w-[640px] text-left text-sm";
export const theadClass = "border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-500";
export const thClass = "whitespace-nowrap px-4 py-3 font-semibold first:pl-5 last:pr-5 sm:first:pl-7 sm:last:pr-7";
export const tdClass = "px-4 py-4 align-middle first:pl-5 last:pr-5 sm:first:pl-7 sm:last:pr-7";
export const trClass = "border-b border-slate-100 transition-colors last:border-0 hover:bg-indigo-50/40";

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
    ? "border-red-200 bg-red-50/80 text-red-800"
    : "border-emerald-200 bg-emerald-50/80 text-emerald-800";
  return <div role={kind === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm shadow-[0_1px_2px_rgb(10_37_64/0.04)] ${style}`}>
    <Icon name={kind === "error" ? "alert" : "check"} className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0">
      <p className="font-medium">{lines[0]}</p>
      {lines.length > 1 && <ul className="mt-1 list-disc space-y-0.5 pl-5">{lines.slice(1).map((l) => <li key={l} className="break-words">{l}</li>)}</ul>}
    </div>
  </div>;
}

// ------------------------------------------------------------- layout ----
export function PageShell({ width = "max-w-6xl", children }) {
  return <main className={pageClass}><div className={`mx-auto w-full ${width} space-y-6`}>{children}</div></main>;
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-2">
    <div className="min-w-0">
      {eyebrow && <div className="mb-3 text-sm">{eyebrow}</div>}
      <h1 className="text-3xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-4xl">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-600">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </header>;
}

export function Card({ title, description, actions, children, className = "" }) {
  return <section className={`${cardClass} ${className}`}>
    {(title || actions) && <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {title && <h2 className={sectionTitleClass}>{title}</h2>}
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions}
    </div>}
    {children}
  </section>;
}

export function EmptyState({ icon = "inbox", title, message, action, bare = false }) {
  return <div className={`${bare ? "" : `${cardClass} `}flex flex-col items-center justify-center px-6 py-10 text-center`}>
    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100"><Icon name={icon} className="h-6 w-6" /></span>
    <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
    {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function Skeleton({ className = "h-4 w-full" }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/70 motion-reduce:animate-none ${className}`} />;
}

// Placeholder cards while a list loads.
export function SkeletonList({ rows = 3, label = "Loading" }) {
  return <div className="space-y-3" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, i) => <div key={i} className={cardClass}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>)}
    <span className="sr-only">{label}…</span>
  </div>;
}

// --------------------------------------------------------------- status ----
// One meaning per colour, used on every page:
// applied gray · shortlisted blue · interviewed violet · offered green · rejected red
export const STATUS_STYLES = {
  applied: "bg-slate-100 text-slate-700 ring-slate-200",
  shortlisted: "bg-blue-50 text-blue-700 ring-blue-200",
  interviewed: "bg-violet-50 text-violet-700 ring-violet-200",
  offered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  // jobs
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  open: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-slate-200 text-slate-700 ring-slate-300",
  // interviews
  scheduled: "bg-blue-50 text-blue-700 ring-blue-200",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
  no_show: "bg-red-50 text-red-700 ring-red-200",
  // offers
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-red-50 text-red-700 ring-red-200",
  withdrawn: "bg-slate-100 text-slate-600 ring-slate-200",
  // accounts
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  inactive: "bg-slate-100 text-slate-600 ring-slate-200",
};

// Solid colour of each pipeline stage, for chart bars and timeline dots.
export const STAGE_DOT = {
  applied: "bg-slate-400", shortlisted: "bg-blue-500", interviewed: "bg-violet-500", offered: "bg-emerald-500", rejected: "bg-red-500",
};

export function StatusBadge({ status }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 align-middle text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[status] || "bg-slate-100 text-slate-700 ring-slate-200"}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{status.replace("_", " ")}
  </span>;
}

// Small neutral tag (skills, counts).
export function Tag({ children, className = "" }) {
  return <span className={`inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ${className}`}>{children}</span>;
}

// ---------------------------------------------------------------- icons ----
// Inline SVG paths (24×24, stroke), so no icon library is needed.
const ICONS = {
  users: "M17 20h5v-2a4 4 0 0 0-5-3.87M9 20H2v-2a4 4 0 0 1 5-3.87m6-4.13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm6 2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  user: "M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.1a7.5 7.5 0 0 1 15 0",
  building: "M3.75 21h16.5M4.5 3h15v18h-15V3Zm4.5 4.5h1.5m-1.5 3h1.5m-1.5 3h1.5m4.5-6h1.5m-1.5 3h1.5m-1.5 3h1.5M10.5 21v-3.75h3V21",
  briefcase: "M20.25 14.15v4.1a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25v-4.1m16.5 0a2.18 2.18 0 0 0 .75-1.66V8.7c0-1.08-.77-2.01-1.84-2.17a48.1 48.1 0 0 0-3.41-.39m4.5 8.01a2.18 2.18 0 0 1-1.45.55H5.2c-.56 0-1.07-.2-1.45-.55m0 0A2.18 2.18 0 0 1 3 12.49V8.7c0-1.08.77-2.01 1.84-2.17a48.1 48.1 0 0 1 3.41-.39m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.89m7.5 0a48.67 48.67 0 0 0-7.5 0",
  file: "M19.5 14.25v-2.63a3.38 3.38 0 0 0-3.38-3.37h-1.5A1.13 1.13 0 0 1 13.5 7.13v-1.5a3.38 3.38 0 0 0-3.38-3.38H8.25m2.25 0H5.63c-.62 0-1.13.5-1.13 1.13v17.25c0 .62.5 1.12 1.13 1.12h12.75c.62 0 1.12-.5 1.12-1.12V11.25a9 9 0 0 0-9-9Z",
  calendar: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
  gift: "M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.88A2.63 2.63 0 1 0 9.38 7.5H12m0-2.63V7.5m0-2.63A2.63 2.63 0 1 1 14.63 7.5H12m0 0V21m-8.63-9.75h18.26c.62 0 1.12-.5 1.12-1.13v-1.5c0-.62-.5-1.12-1.12-1.12H3.37c-.62 0-1.12.5-1.12 1.12v1.5c0 .63.5 1.13 1.12 1.13Z",
  bell: "M14.86 17.08a23.85 23.85 0 0 0 5.45-1.31A8.97 8.97 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.97 8.97 0 0 1-2.31 6.02c1.73.64 3.56 1.09 5.45 1.31m5.72 0a24.26 24.26 0 0 1-5.72 0m5.72 0a3 3 0 1 1-5.72 0",
  chart: "M3 13.13C3 12.5 3.5 12 4.13 12h2.25c.62 0 1.12.5 1.12 1.13v6.75c0 .62-.5 1.12-1.12 1.12H4.13C3.5 21 3 20.5 3 19.88v-6.75Zm6.75-4.5c0-.62.5-1.13 1.13-1.13h2.25c.62 0 1.12.5 1.12 1.13v11.25c0 .62-.5 1.12-1.12 1.12h-2.25c-.63 0-1.13-.5-1.13-1.12V8.63Zm6.75-4.5c0-.62.5-1.13 1.13-1.13h2.25C20.5 3 21 3.5 21 4.13v15.75c0 .62-.5 1.12-1.12 1.12h-2.25c-.63 0-1.13-.5-1.13-1.12V4.13Z",
  inbox: "M2.25 13.5h3.86a2.25 2.25 0 0 1 2.01 1.24l.27.53a2.25 2.25 0 0 0 2.01 1.24h3.2a2.25 2.25 0 0 0 2.01-1.24l.27-.53a2.25 2.25 0 0 1 2.01-1.24h3.86M2.25 13.5V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.5m-19.5 0 2.48-7.69A2.25 2.25 0 0 1 6.88 4.5h10.24a2.25 2.25 0 0 1 2.14 1.31l2.49 7.69",
  sparkles: "M9.81 15.9 9 18.75l-.81-2.85a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.85-.81a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.81 2.85a4.5 4.5 0 0 0 3.09 3.09l2.85.81-2.85.81a4.5 4.5 0 0 0-3.09 3.09ZM18.26 8.72 18 9.75l-.26-1.03a3.38 3.38 0 0 0-2.46-2.46L14.25 6l1.03-.26a3.38 3.38 0 0 0 2.46-2.46L18 2.25l.26 1.03a3.38 3.38 0 0 0 2.46 2.46l1.03.26-1.03.26a3.38 3.38 0 0 0-2.46 2.46Z",
  plus: "M12 4.5v15m7.5-7.5h-15",
  arrowRight: "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3",
  shield: "M9 12.75 11.25 15 15 9.75m-3-7.04A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.6 3.82 10.3 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15c-3.2 0-6.1-1.25-8.25-3.29Z",
  database: "M20.25 6.38c0 2.27-3.69 4.12-8.25 4.12S3.75 8.65 3.75 6.38m16.5 0c0-2.28-3.69-4.13-8.25-4.13S3.75 4.1 3.75 6.38m16.5 0v11.25c0 2.28-3.69 4.12-8.25 4.12s-8.25-1.84-8.25-4.12V6.38m16.5 5.62c0 2.28-3.69 4.13-8.25 4.13S3.75 14.28 3.75 12",
  upload: "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5",
  cube: "m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z",
  menu: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
  close: "M6 18 18 6M6 6l12 12",
  chevronDown: "m19.5 8.25-7.5 7.5-7.5-7.5",
  logout: "M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9",
  alert: "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.01v.01H12v-.01Z",
  check: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  search: "m21 21-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z",
  star: "M11.48 3.5a.56.56 0 0 1 1.04 0l2.13 5.11c.08.2.27.33.48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 0 0-.18.56l1.28 5.38a.56.56 0 0 1-.84.61l-4.72-2.88a.56.56 0 0 0-.59 0l-4.72 2.88a.56.56 0 0 1-.84-.61l1.28-5.38a.56.56 0 0 0-.18-.56l-4.2-3.6a.56.56 0 0 1 .32-.99l5.52-.44a.56.56 0 0 0 .48-.35l2.13-5.11Z",
  pencil: "m16.86 4.49 1.69-1.69a1.88 1.88 0 1 1 2.65 2.65L10.58 16.07a4.5 4.5 0 0 1-1.9 1.13L6 18l.8-2.69a4.5 4.5 0 0 1 1.13-1.9l8.93-8.92Zm0 0L19.5 7.13",
  trash: "m14.74 9-.35 9m-4.78 0-.35-9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17-1.07 13.88A2.25 2.25 0 0 1 15.92 21H8.08a2.25 2.25 0 0 1-2.24-2.08L4.77 5.79m14.46 0a48.1 48.1 0 0 0-3.48-.4m-12 .57c.34-.06.68-.11 1.02-.16m0 0a48.11 48.11 0 0 1 3.48-.4m7.5 0v-.92c0-1.18-.91-2.16-2.09-2.2a51.96 51.96 0 0 0-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.92m7.5 0a48.67 48.67 0 0 0-7.5 0",
};

export function Icon({ name, className = "h-5 w-5" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={ICONS[name] || ICONS.inbox} />
  </svg>;
}

// Arrow that slides a little on hover of the parent `group` (main CTAs).
export function CtaArrow() {
  return <Icon name="arrowRight" className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" />;
}

// TalentMatch logo mark: two overlapping circles (a resume and a job
// "matching") on a gradient tile. Drawn here, no image file.
export function LogoMark({ className = "h-8 w-8" }) {
  const id = useId();
  return <svg aria-hidden="true" viewBox="0 0 32 32" className={className}>
    <defs>
      <linearGradient id={`${id}-g`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#635BFF" />
        <stop offset="0.6" stopColor="#7A5CFF" />
        <stop offset="1" stopColor="#00B8E6" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill={`url(#${id}-g)`} />
    <circle cx="12.5" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2.2" />
    <circle cx="19.5" cy="16" r="6" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.2" />
  </svg>;
}

// Match score as the exact number plus a slim bar (cosine similarity, 0 to 1
// in practice). null = not computed yet, shown as text, never as 0.
export function ScoreMeter({ score, className = "w-32", size = "sm" }) {
  if (score == null) return <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600" title="Resume or job not embedded yet">not scored</span>;
  const pct = Math.max(0, Math.min(100, score * 100));
  return <div className={className}>
    <p className={`font-semibold tabular-nums tracking-tight text-slate-900 ${size === "lg" ? "text-xl" : "text-sm"}`}>{formatScore(score)}</p>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-sky-400" style={{ width: `${pct}%` }} />
    </div>
  </div>;
}

// ----------------------------------------------------------- formatting ----
// Dates: "16 Oct 2026" / "16 Oct 2026, 8:49 pm", shared with the server code
// that writes notification texts (src/lib/format-date.js).
export { formatDate, formatDateTime };

export const formatMoney = (amount, currency = "INR") =>
  `${currency === "INR" ? "₹" : `${currency} `}${Number(amount).toLocaleString("en-IN")}`;

// Similarity is a cosine in [-1, 1]; null means "not computed yet".
export const formatScore = (score) => (score == null ? "not scored" : score.toFixed(4));

export const EMPLOYMENT_LABELS = { full_time: "Full time", part_time: "Part time", contract: "Contract", internship: "Internship" };

export function formatSalary(job) {
  if (job.salaryMin == null && job.salaryMax == null) return "Salary not disclosed";
  const lakh = (v) => `${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  const range = [job.salaryMin, job.salaryMax].filter((v) => v != null).map(lakh).join(" – ");
  return `${job.currency === "INR" ? "₹" : `${job.currency} `}${range} per year`;
}

// Vertical status timeline built from application_status_history rows.
export function StatusTimeline({ history }) {
  return <ol className="relative ml-2 border-l-2 border-slate-100">
    {history.map((h, i) => <li key={i} className="mb-3 ml-4 last:mb-0">
      <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white shadow-sm ${STAGE_DOT[h.newStatus] || "bg-slate-400"}`} />
      <p className="text-sm text-slate-800">
        {h.oldStatus ? <><span className="capitalize text-slate-500">{h.oldStatus}</span> → </> : null}
        <StatusBadge status={h.newStatus} />
        <span className="ml-2 inline-block text-xs text-slate-500">{formatDateTime(h.changedAt)}{h.changedBy ? ` · ${h.changedBy}` : ""}</span>
      </p>
      {h.note && <p className="text-xs text-slate-600">{h.note}</p>}
    </li>)}
  </ol>;
}

// Re-render once after mount (used to animate bars from 0 to their width).
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id); }, []);
  return mounted;
}

// Other components (the notifications inbox) fire this after marking items
// read, so the bell badge in the top nav refreshes without a page reload.
export const NOTIFICATIONS_CHANGED = "talentmatch:notifications-changed";
