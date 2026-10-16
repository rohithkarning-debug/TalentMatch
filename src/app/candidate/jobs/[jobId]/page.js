import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import CandidateJobDetail from "@/components/candidate/CandidateJobDetail";

export const metadata = { title: "Job · TalentMatch" };

export default function CandidateJobPage({ params }) {
  return <Suspense fallback={<main className="mx-auto w-full max-w-4xl p-6 text-sm text-zinc-500">Loading job…</main>}><CandidateJobContent params={params} /></Suspense>;
}

async function CandidateJobContent({ params }) {
  const [{ jobId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <CandidateJobDetail jobId={jobId} />;
}
