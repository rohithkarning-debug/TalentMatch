import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import JobForm from "@/components/recruiter/JobForm";

export const metadata = { title: "Post a job · TalentMatch" };

export default function NewJobPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl p-6 text-sm text-zinc-500">Loading…</main>}><NewJobContent /></Suspense>;
}

async function NewJobContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <JobForm />;
}
