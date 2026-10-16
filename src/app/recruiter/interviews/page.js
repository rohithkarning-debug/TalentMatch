import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import RecruiterInterviews from "@/components/recruiter/RecruiterInterviews";

export const metadata = { title: "Interviews · TalentMatch" };

export default function RecruiterInterviewsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading interviews…</main>}><RecruiterInterviewsContent /></Suspense>;
}

async function RecruiterInterviewsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <RecruiterInterviews />;
}
