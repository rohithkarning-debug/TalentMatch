import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import TopNav, { TopNavSkeleton } from "@/components/nav/TopNav";
import { getCurrentUser } from "@/lib/auth/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "TalentMatch",
  description: "AI-assisted resume-to-job matching and recruitment management",
};

// Reading the session cookie is request-time data, so the nav that needs the
// user sits in its own <Suspense> boundary (Cache Components). The rest of
// the layout is static and streams immediately.
async function SessionNav() {
  const user = await getCurrentUser();
  return <TopNav user={user} />;
}

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50 font-sans text-slate-900">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
        <Suspense fallback={<TopNavSkeleton />}>
          <SessionNav />
        </Suspense>
        <div id="main" className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
