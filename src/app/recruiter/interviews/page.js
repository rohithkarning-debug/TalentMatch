import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterInterviews from "@/components/recruiter/RecruiterInterviews";

export const metadata = { title: "Interviews · TalentMatch" };

export default function RecruiterInterviewsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl p-6 text-sm text-zinc-500">Loading interviews…</main>}><RecruiterInterviewsContent /></Suspense>;
}

async function RecruiterInterviewsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterInterviews />;
}
