"use client";

// Small presentational pieces shared by the login and register forms.

import { LogoMark } from "@/components/ui";

// Centered card over the angled gradient band (same band as the landing hero).
export function AuthCard({ title, subtitle, children, below }) {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 pb-16 pt-12 sm:pt-20">
      <div aria-hidden="true" className="tm-gradient tm-gradient-animated tm-angled absolute inset-x-0 top-0 -z-10 h-[420px] sm:h-[480px]" />
      <div className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white p-6 shadow-lift sm:p-9">
        <LogoMark className="h-10 w-10" />
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>}
        <div className="mt-7">{children}</div>
      </div>
      {below}
    </main>
  );
}

export function Field({ id, label, type = "text", value, onChange, error, autoComplete, disabled }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-[0_1px_1px_rgb(10_37_64/0.04)] transition-colors focus:outline-none focus:ring-4 disabled:opacity-60 ${
          error
            ? "border-red-500 focus:ring-red-200"
            : "border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/15"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormAlert({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

export function SubmitButton({ loading, children, loadingText }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group flex w-full items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgb(10_37_64/0.15)] transition hover:bg-indigo-700 hover:shadow-[0_4px_12px_-2px_rgb(99_91_255/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? loadingText : <>{children}<span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0">&rarr;</span></>}
    </button>
  );
}

// Turn a zod flattenError() result ({ formErrors, fieldErrors }) into
// { field: "first message" } for display.
export function firstFieldErrors(flat) {
  const out = {};
  for (const [field, messages] of Object.entries(flat?.fieldErrors ?? {})) {
    if (messages?.length) out[field] = messages[0];
  }
  return out;
}

// POST JSON and return { ok, status, data }. Never throws for HTTP errors.
export async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { message: "Network error. Check your connection and try again." } } };
  }
}
