import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HOME_FOR_ROLE } from "@/lib/roles";
import { getCurrentUser } from "@/lib/auth/session";

// Landing page. Signed-in users go straight to their role's home page.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-8 sm:p-10">
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">Recruitment, matched by meaning</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">TalentMatch</h1>
        <p className="mt-3 text-slate-600">
          AI-assisted resume-to-job matching and recruitment management. Resumes and jobs are embedded with a
          sentence-transformer model and ranked by cosine similarity in PostgreSQL (pgvector).
        </p>
        <div className="mt-8">
          {/* Reading the session cookie is request-time data, so it must sit
              behind a Suspense boundary (Cache Components). */}
          <Suspense fallback={<p className="text-sm text-slate-500">Checking your session…</p>}>
            <SessionPanel />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function SessionPanel() {
  const user = await getCurrentUser();
  if (user) redirect(HOME_FOR_ROLE[user.role] || "/notifications");

  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/login" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        Sign in
      </Link>
      <Link href="/register" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        Create candidate account
      </Link>
    </div>
  );
}
