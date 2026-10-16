"use client";

// Top navigation shared by every page: logo, role-based links, notification
// bell with unread badge, and a user menu with sign-out.
// The links only help people find pages. Every page and API route still
// checks the role on the server.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, LogoMark, NOTIFICATIONS_CHANGED, request } from "@/components/ui";
import { HOME_FOR_ROLE } from "@/lib/roles";

export const NAV_LINKS = {
  admin: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/companies", label: "Companies" },
    { href: "/admin/recruiters", label: "Recruiters" },
  ],
  recruiter: [
    { href: "/recruiter", label: "My jobs" },
    { href: "/recruiter/interviews", label: "Interviews" },
    { href: "/recruiter/offers", label: "Offers" },
  ],
  candidate: [
    { href: "/candidate", label: "Profile" },
    { href: "/candidate/jobs", label: "Jobs" },
    { href: "/candidate/applications", label: "Applications" },
    { href: "/candidate/interviews", label: "Interviews" },
    { href: "/candidate/offers", label: "Offers" },
  ],
};

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// The active link is the LONGEST href that prefixes the path, so
// /candidate/jobs/3 highlights "Jobs", not "Profile".
function activeHref(links, pathname) {
  return links
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");

function NotificationBell({ pathname }) {
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    request("/api/notifications?unreadOnly=true&limit=1").then((r) => { if (r.ok) setCount(r.body.unreadCount); });
  }, []);
  useEffect(() => { load(); }, [load, pathname]);
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, load);
  }, [load]);
  const label = count ? `Notifications, ${count} unread` : "Notifications";
  return <Link href="/notifications" aria-label={label} title={label}
    className={`relative flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 ${ring}`}>
    <Icon name="bell" className="h-5 w-5" />
    {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none tabular-nums text-white ring-2 ring-white">
      {count > 99 ? "99+" : count}
    </span>}
  </Link>;
}

function UserMenu({ user }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function logout() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return <div className="relative" ref={ref}>
    <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
      className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 ${ring}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-sky-500 text-xs font-semibold text-white">{initials(user.fullName)}</span>
      <span className="hidden max-w-[10rem] truncate font-medium md:inline">{user.fullName}</span>
      <Icon name="chevronDown" className="h-4 w-4 text-slate-400" />
    </button>
    {open && <div role="menu" className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lift">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
        <p className="truncate text-xs text-slate-500">{user.email}</p>
        <span className="mt-2 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium capitalize text-indigo-700">{user.role}</span>
      </div>
      <div className="p-1">
        <Link role="menuitem" href="/notifications" onClick={() => setOpen(false)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${ring}`}>
          <Icon name="bell" className="h-4 w-4 text-slate-400" /> Notifications
        </Link>
        <button role="menuitem" type="button" onClick={logout} disabled={signingOut}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 ${ring}`}>
          <Icon name="logout" className="h-4 w-4 text-slate-400" /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>}
  </div>;
}

export default function TopNav({ user }) {
  const pathname = usePathname() || "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = user ? NAV_LINKS[user.role] || [] : [];
  const active = activeHref(links, pathname);
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const linkClass = (href) => `rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${ring} ${href === active
    ? "bg-indigo-50 text-indigo-700"
    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`;

  return <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
    <div className="mx-auto flex h-16 max-w-6xl items-center gap-3">
      <Link href={user ? HOME_FOR_ROLE[user.role] || "/" : "/"} className={`flex shrink-0 items-center gap-2.5 rounded-lg ${ring}`}>
        <LogoMark className="h-8 w-8" />
        <span className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">TalentMatch</span>
      </Link>

      {links.length > 0 && <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
        {links.map((l) => <Link key={l.href} href={l.href} className={linkClass(l.href)} aria-current={l.href === active ? "page" : undefined}>{l.label}</Link>)}
      </nav>}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {user ? <>
          <NotificationBell pathname={pathname} />
          <UserMenu user={user} />
          {links.length > 0 && <button type="button" onClick={() => setMobileOpen((v) => !v)} aria-expanded={mobileOpen} aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 md:hidden ${ring}`}>
            <Icon name={mobileOpen ? "close" : "menu"} className="h-5 w-5" />
          </button>}
        </> : <>
          <Link href="/login" className={`rounded-full px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 ${ring}`}>Sign in</Link>
          <Link href="/register" className={`group inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 ${ring}`}>
            Get started <Icon name="arrowRight" className="hidden h-3.5 w-3.5 sm:block" />
          </Link>
        </>}
      </div>
    </div>
    {mobileOpen && <nav id="mobile-nav" aria-label="Main" className="-mx-4 space-y-1 border-t border-slate-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6 md:hidden">
      {links.map((l) => <Link key={l.href} href={l.href} className={`block ${linkClass(l.href)}`} aria-current={l.href === active ? "page" : undefined}>{l.label}</Link>)}
    </nav>}
  </header>;
}

// Shown while the session is being read (Suspense fallback): same height, no layout shift.
export function TopNavSkeleton() {
  return <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 px-4 sm:px-6 lg:px-8">
    <div className="mx-auto flex h-16 max-w-6xl items-center gap-2.5">
      <LogoMark className="h-8 w-8" />
      <span className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">TalentMatch</span>
    </div>
  </header>;
}
