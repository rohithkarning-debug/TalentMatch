import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import CandidateDashboard from "@/components/candidate/CandidateDashboard";

export const metadata = { title: "Candidate dashboard · TalentMatch" };

export default function CandidatePage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading candidate dashboard…</main>}><CandidatePageContent /></Suspense>;
}

async function CandidatePageContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <CandidateDashboard />;
}
