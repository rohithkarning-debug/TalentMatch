"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { registerSchema } from "@/lib/validation/auth";
import { AuthCard, Field, FormAlert, SubmitButton, firstFieldErrors, postJson } from "./AuthFormParts";

// Public sign-up creates CANDIDATE accounts only. There is deliberately no
// role field: recruiter and admin accounts are created by an admin.
export default function RegisterForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setFormError("");

    const parsed = registerSchema.safeParse({ fullName, email, password });
    const errors = parsed.success ? {} : firstFieldErrors(z.flattenError(parsed.error));
    if (password !== confirm) errors.confirm = "Passwords do not match";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setLoading(true);

    const { ok, data } = await postJson("/api/auth/register", parsed.data);
    if (ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setLoading(false);
    const serverFieldErrors = firstFieldErrors(data?.error?.details);
    if (data?.error?.code === "EMAIL_TAKEN") serverFieldErrors.email = data.error.message;
    setFieldErrors(serverFieldErrors);
    setFormError(data?.error?.message || "Registration failed. Please try again.");
  }

  return (
    <AuthCard title="Create a candidate account" subtitle="Upload your resume and get matched to jobs.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field id="fullName" label="Full name" autoComplete="name"
               value={fullName} onChange={setFullName} error={fieldErrors.fullName} disabled={loading} />
        <Field id="email" label="Email" type="email" autoComplete="email"
               value={email} onChange={setEmail} error={fieldErrors.email} disabled={loading} />
        <Field id="password" label="Password" type="password" autoComplete="new-password"
               value={password} onChange={setPassword} error={fieldErrors.password} disabled={loading} />
        <p className="-mt-2 text-xs text-slate-500">At least 8 characters, including a letter and a number.</p>
        <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password"
               value={confirm} onChange={setConfirm} error={fieldErrors.confirm} disabled={loading} />
        <SubmitButton loading={loading} loadingText="Creating account…">Create account</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
