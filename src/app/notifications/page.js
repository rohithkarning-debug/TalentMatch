import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import NotificationsInbox from "@/components/NotificationsInbox";

export const metadata = { title: "Notifications · TalentMatch" };

export default function NotificationsInboxPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6 lg:px-8 text-slate-500">Loading notifications…</main>}><NotificationsInboxContent /></Suspense>;
}

async function NotificationsInboxContent() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Every role has an inbox; the API returns only this user's rows.
  return <NotificationsInbox />;
}
