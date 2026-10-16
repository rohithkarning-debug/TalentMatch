"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { loginSchema } from "@/lib/validation/auth";
import { AuthCard, Field, FormAlert, SubmitButton, firstFieldErrors, postJson } from "./AuthFormParts";

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
    <AuthCard title="Sign in to TalentMatch" subtitle="Candidates, recruiters and admins all sign in here.">
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
        <Link href="/register" className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
