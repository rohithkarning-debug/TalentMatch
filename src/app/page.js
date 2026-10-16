import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Icon, LogoMark } from "@/components/ui";
import { HOME_FOR_ROLE } from "@/lib/roles";
import { getCurrentUser } from "@/lib/auth/session";

// Public landing page. Signed-in users are sent to their role's home page.
// The product preview is a static HTML/CSS illustration with fictional
// names and example numbers, not live data.

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const PREVIEW = [
  { name: "Priya Nair", role: "Data Analyst · 3 yrs", score: 0.8312, status: "Shortlisted", tone: "bg-blue-50 text-blue-700 ring-blue-200" },
  { name: "Kabir Sethi", role: "BI Developer · 4 yrs", score: 0.7964, status: "Interviewed", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  { name: "Leena Joseph", role: "Analytics Engineer · 2 yrs", score: 0.7421, status: "Applied", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
  { name: "Dev Anand Rao", role: "SQL Developer · 5 yrs", score: 0.6887, status: "Applied", tone: "bg-slate-100 text-slate-700 ring-slate-200" },
];

const STEPS = [
  { icon: "upload", title: "Upload a resume", text: "Candidates upload a PDF or TXT resume. We extract the text and keep the file private to them." },
  { icon: "cube", title: "We embed it", text: "A sentence-transformer model turns the resume and every job into 384-number vectors that capture meaning." },
  { icon: "users", title: "Recruiters see ranked matches", text: "PostgreSQL ranks applicants by cosine similarity, so the closest fit is at the top, with the exact score shown." },
];

const FEATURES = [
  { icon: "sparkles", title: "Semantic matching", text: "“Built dashboards in Power BI” matches a BI analyst job even without the exact keywords." },
  { icon: "target", title: "Skill-gap view", text: "Candidates see which required skills they have and which they still need, per job." },
  { icon: "briefcase", title: "Hiring pipeline", text: "Applied → shortlisted → interviewed → offered, with every move checked and audited by the database." },
  { icon: "calendar", title: "Interviews and offers", text: "Schedule rounds, record ratings, make offers and let candidates accept or decline." },
  { icon: "chart", title: "Analytics dashboard", text: "Stage counts, in-demand skills and match scores by outcome, computed live from SQL views." },
  { icon: "shield", title: "Role-based security", text: "Admin, recruiter and candidate roles, checked on the server for every request." },
];

export default function Home() {
  return (
    <main className="flex-1 overflow-x-hidden">
      {/* Reading the session cookie is request-time data, so the redirect
          check sits behind a Suspense boundary (Cache Components). */}
      <Suspense fallback={null}><RedirectSignedIn /></Suspense>

      {/* ---------------------------------------------------------- hero */}
      <section className="relative isolate">
        <div aria-hidden="true" className="tm-gradient tm-gradient-animated tm-angled absolute inset-0 -z-10" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-28 pt-16 sm:px-6 sm:pb-40 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:px-8">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur">
              <Icon name="sparkles" className="h-3.5 w-3.5" /> Resume-to-job matching with pgvector
            </p>
            <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-white sm:text-6xl">
              Match candidates by meaning, not keywords.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/85">
              TalentMatch reads every resume and job description, understands what they say, and ranks the best fits
              for recruiters, with the similarity score right next to each name.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/register" className={`group inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lift transition hover:-translate-y-px hover:bg-indigo-50 motion-reduce:hover:translate-y-0 focus-visible:ring-white focus-visible:ring-offset-slate-900 ${ring}`}>
                Get started <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0" />
              </Link>
              <Link href="/login" className={`inline-flex items-center rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/40 backdrop-blur transition hover:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-slate-900 ${ring}`}>
                Sign in
              </Link>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* -------------------------------------------------- how it works */}
      <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <p className="text-sm font-semibold text-indigo-600">How it works</p>
        <h2 id="how" className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl">From resume to ranked shortlist in three steps.</h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100"><Icon name={s.icon} className="h-5 w-5" /></span>
                <span className="text-sm font-semibold tabular-nums text-slate-400">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------ features */}
      <section aria-labelledby="features" className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <p className="text-sm font-semibold text-indigo-600">Features</p>
          <h2 id="features" className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.03em] text-slate-900 sm:text-4xl">Everything a small hiring team needs.</h2>
          <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="border-l-2 border-indigo-100 pl-5">
                <Icon name={f.icon} className="h-6 w-6 text-indigo-600" />
                <h3 className="mt-3 text-base font-semibold tracking-tight text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- database */}
      <section aria-labelledby="stack" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="grid items-center gap-10 rounded-3xl bg-slate-900 p-8 text-white shadow-lift sm:p-12 lg:grid-cols-[1.3fr_1fr]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sky-300">Under the hood</p>
            <h2 id="stack" className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Built on PostgreSQL + pgvector.</h2>
            <p className="mt-5 leading-relaxed text-slate-300">
              One database holds both kinds of data. Ordinary tables with keys, constraints, triggers and views keep users,
              jobs and applications consistent, while the pgvector extension stores each resume and job as a 384-dimension
              embedding next to them. Ranking is a single SQL query using the cosine distance operator <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm text-white">&lt;=&gt;</code> on
              an HNSW index, so scores, joins and access rules all live in the same transaction.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-center">
            {[["384", "vector dimensions"], ["HNSW", "similarity index"], ["16", "relational tables"], ["3", "user roles"]].map(([v, l]) => (
              <div key={l} className="rounded-2xl bg-white/5 p-5 ring-1 ring-inset ring-white/10">
                <dt className="sr-only">{l}</dt>
                <dd className="text-2xl font-bold tabular-nums tracking-tight">{v}</dd>
                <dd className="mt-1 text-xs text-slate-300">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------- footer */}
      <footer className="border-t border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <span className="font-bold tracking-[-0.02em] text-slate-900">TalentMatch</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/login" className={`rounded text-slate-600 hover:text-slate-900 focus-visible:ring-indigo-500 ${ring}`}>Sign in</Link>
            <Link href="/register" className={`rounded text-slate-600 hover:text-slate-900 focus-visible:ring-indigo-500 ${ring}`}>Create account</Link>
          </nav>
          <p className="text-sm text-slate-500">DBMS mini-project · PES University · Sample data is fictional.</p>
        </div>
      </footer>
    </main>
  );
}

async function RedirectSignedIn() {
  const user = await getCurrentUser();
  if (user) redirect(HOME_FOR_ROLE[user.role] || "/notifications");
  return null;
}

// Static illustration of the recruiter's ranked list.
function ProductPreview() {
  return (
    <div aria-label="Example: applicants ranked by match score" role="img" className="relative min-w-0">
      <div className="rounded-2xl border border-white/40 bg-white p-5 shadow-lift sm:p-6 lg:rotate-[-1deg] motion-reduce:rotate-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ranked applicants</p>
            <p className="mt-1 truncate font-semibold text-slate-900">Data Analyst · Example Co.</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Open</span>
        </div>
        <ul className="mt-5 space-y-2.5">
          {PREVIEW.map((p, i) => (
            <li key={p.name} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold tabular-nums text-indigo-700">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                <p className="truncate text-xs text-slate-500">{p.role}</p>
              </div>
              <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset sm:inline ${p.tone}`}>{p.status}</span>
              <div className="w-20 shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-900">{p.score.toFixed(4)}</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-sky-400" style={{ width: `${p.score * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">score = 1 − cosine distance (resume ⟷ job)</p>
      </div>
    </div>
  );
}
