import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterOffers from "@/components/recruiter/RecruiterOffers";

export const metadata = { title: "Offers · TalentMatch" };

export default function RecruiterOffersPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading offers…</main>}><RecruiterOffersContent /></Suspense>;
}

async function RecruiterOffersContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterOffers />;
}
