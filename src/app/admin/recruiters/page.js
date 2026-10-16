import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { SkeletonList } from "@/components/ui";
import RecruiterManager from "@/components/admin/RecruiterManager";

export const metadata = { title: "Recruiters · TalentMatch" };

// Server-side role check: non-admins are redirected before anything renders.
// The API routes check the admin role again on every request.
export default function AdminRecruitersPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><SkeletonList rows={3} label="Loading" /></main>}><AdminRecruitersPageContent /></Suspense>;
}

async function AdminRecruitersPageContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <RecruiterManager />;
}
