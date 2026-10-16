import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterJobs from "@/components/recruiter/RecruiterJobs";

export const metadata = { title: "My jobs · TalentMatch" };

export default function RecruiterPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading jobs…</main>}><RecruiterPageContent /></Suspense>;
}

async function RecruiterPageContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterJobs />;
}
