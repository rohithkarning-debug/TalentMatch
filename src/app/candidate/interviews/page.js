import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import CandidateInterviews from "@/components/candidate/CandidateInterviews";

export const metadata = { title: "My interviews · TalentMatch" };

export default function CandidateInterviewsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading my interviews…</main>}><CandidateInterviewsContent /></Suspense>;
}

async function CandidateInterviewsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <CandidateInterviews />;
}
