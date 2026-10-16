"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { loginSchema } from "@/lib/validation/auth";
import { AuthCard, Field, FormAlert, SubmitButton, firstFieldErrors, postJson } from "./AuthFormParts";

// Seeded demo accounts, listed under the form in development only. The
// condition is replaced at build time, so production bundles contain an
// empty list. Clicking one only fills the form; sign-in still goes through
// the normal API.
const DEMO_ACCOUNTS = process.env.NODE_ENV === "development" ? [
  { role: "Admin", name: "Platform Admin", email: "admin@talentmatch.example" },
  { role: "Recruiter", name: "Arjun Rao · Nimbus Analytics", email: "arjun.rao@nimbusanalytics.example" },
  { role: "Recruiter", name: "Kavya Menon · Kestrel Labs", email: "kavya.menon@kestrellabs.example" },
  { role: "Candidate", name: "Aditi Sharma", email: "aditi.sharma@mail.example" },
  { role: "Candidate", name: "Rohan Verma", email: "rohan.verma@mail.example" },
] : [];
const DEMO_PASSWORD = process.env.NODE_ENV === "development" ? "TalentMatch@2026" : "";

function DemoAccounts({ onPick }) {
  if (DEMO_ACCOUNTS.length === 0) return null;
  return (
    <section aria-labelledby="demo-accounts" className="mt-6 w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-card backdrop-blur">
      <h2 id="demo-accounts" className="text-xs font-semibold uppercase tracking-wider text-slate-500">Demo accounts · development only</h2>
      <p className="mt-1 text-xs text-slate-500">Password for all: <code className="font-mono text-slate-700">{DEMO_PASSWORD}</code>. Click one to fill the form.</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email}>
            <button type="button" onClick={() => onPick(a.email)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{a.name}</span>
                <span className="block truncate text-xs text-slate-500">{a.email}</span>
              </span>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">{a.role}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");

    // Same zod schema as the server, for instant feedback. The server still
    // validates everything again; this is only a convenience.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(firstFieldErrors(z.flattenError(parsed.error)));
      return;
    }
    setFieldErrors({});
    setLoading(true);

    const { ok, data } = await postJson("/api/auth/login", parsed.data);
    if (ok) {
      // The session cookie was set by the server (httpOnly); nothing is
      // stored in localStorage/sessionStorage.
      router.replace("/");
      router.refresh();
      return;
    }
    setLoading(false);
    setFieldErrors(firstFieldErrors(data?.error?.details));
    setFormError(data?.error?.message || "Login failed. Please try again.");
  }

  return (
    <AuthCard title="Sign in to TalentMatch" subtitle="Candidates, recruiters and admins all sign in here."
      below={<DemoAccounts onPick={(demoEmail) => { setEmail(demoEmail); setPassword(DEMO_PASSWORD); setFieldErrors({}); setFormError(""); }} />}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field id="email" label="Email" type="email" autoComplete="email"
               value={email} onChange={setEmail} error={fieldErrors.email} disabled={loading} />
        <Field id="password" label="Password" type="password" autoComplete="current-password"
               value={password} onChange={setPassword} error={fieldErrors.password} disabled={loading} />
        <SubmitButton loading={loading} loadingText="Signing in…">Sign in</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New candidate?{" "}
        <Link href="/register" className="rounded font-semibold text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
