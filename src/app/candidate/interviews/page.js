import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import CandidateInterviews from "@/components/candidate/CandidateInterviews";

export const metadata = { title: "My interviews · TalentMatch" };

export default function CandidateInterviewsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading my interviews…</main>}><CandidateInterviewsContent /></Suspense>;
}

async function CandidateInterviewsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <CandidateInterviews />;
}
