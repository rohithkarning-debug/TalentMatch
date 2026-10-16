import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import JobForm from "@/components/recruiter/JobForm";

export const metadata = { title: "Edit job · TalentMatch" };

export default function EditJobPage({ params }) {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl p-6 text-sm text-slate-500">Loading job…</main>}><EditJobContent params={params} /></Suspense>;
}

async function EditJobContent({ params }) {
  const [{ jobId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");
  if (user.role !== "recruiter") redirect("/");
  return <JobForm jobId={jobId} />;
}
