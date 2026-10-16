import Link from "next/link";
import { Suspense } from "react";
import LogoutButton from "@/components/auth/LogoutButton";
import { getCurrentUser } from "@/lib/auth/session";

// Minimal landing page (Stage 3). Role dashboards come in later stages.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">TalentMatch</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          AI-assisted resume-to-job matching and recruitment management.
        </p>
        <div className="mt-8">
          {/* Reading the session cookie is request-time data, so it must sit
              behind a Suspense boundary (Cache Components). */}
          <Suspense fallback={<p className="text-sm text-zinc-500">Checking your session…</p>}>
            <SessionPanel />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function SessionPanel() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-wrap gap-3">
        <Link href="/login" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
          Sign in
        </Link>
        <Link href="/register" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900">
          Create candidate account
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
      <div>
        <p className="text-sm text-zinc-500">Signed in as</p>
        <p className="font-medium text-zinc-900 dark:text-zinc-50">{user.fullName}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {user.email} · <span className="capitalize">{user.role}</span>
        </p>
        {user.role === "candidate" && (
          <Link href="/candidate" className="mt-3 inline-flex rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
            Open candidate dashboard →
          </Link>
        )}
      </div>
      <LogoutButton />
    </div>
  );
}
