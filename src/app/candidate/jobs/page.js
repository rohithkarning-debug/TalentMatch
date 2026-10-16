import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import JobBrowser from "@/components/candidate/JobBrowser";

export const metadata = { title: "Browse jobs · TalentMatch" };

export default function CandidateJobsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading jobs…</main>}><CandidateJobsContent /></Suspense>;
}

async function CandidateJobsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <JobBrowser />;
}
