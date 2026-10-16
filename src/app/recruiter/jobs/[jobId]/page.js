import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterJobDetail from "@/components/recruiter/RecruiterJobDetail";

export const metadata = { title: "Job · TalentMatch" };

// params is request-time data (no generateStaticParams), so it is awaited
// inside the Suspense boundary, as the Next.js 16 docs require.
export default function RecruiterJobPage({ params }) {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading job…</main>}><RecruiterJobContent params={params} /></Suspense>;
}

async function RecruiterJobContent({ params }) {
  const [{ jobId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterJobDetail jobId={jobId} />;
}
