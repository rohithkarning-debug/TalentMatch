import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import CandidateOffers from "@/components/candidate/CandidateOffers";

export const metadata = { title: "My offers · TalentMatch" };

export default function CandidateOffersPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading my offers…</main>}><CandidateOffersContent /></Suspense>;
}

async function CandidateOffersContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <CandidateOffers />;
}
