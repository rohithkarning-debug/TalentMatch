import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterJobs from "@/components/recruiter/RecruiterJobs";

export const metadata = { title: "My jobs · TalentMatch" };

export default function RecruiterPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading jobs…</main>}><RecruiterPageContent /></Suspense>;
}

async function RecruiterPageContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterJobs />;
}
