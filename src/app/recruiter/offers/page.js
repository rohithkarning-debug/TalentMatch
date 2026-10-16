import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterOffers from "@/components/recruiter/RecruiterOffers";

export const metadata = { title: "Offers · TalentMatch" };

export default function RecruiterOffersPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading offers…</main>}><RecruiterOffersContent /></Suspense>;
}

async function RecruiterOffersContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterOffers />;
}
