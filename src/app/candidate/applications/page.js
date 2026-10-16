import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import MyApplications from "@/components/candidate/MyApplications";

export const metadata = { title: "My applications · TalentMatch" };

export default function MyApplicationsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-4xl p-6 text-sm text-zinc-500">Loading applications…</main>}><MyApplicationsContent /></Suspense>;
}

async function MyApplicationsContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "candidate") redirect("/");
  return <MyApplications />;
}
