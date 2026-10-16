"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarList, KpiCard } from "@/components/charts";
import {
  Alert, Card, EmptyState, errorLines, Icon, linkClass, PageHeader, PageShell, request, Skeleton, StatusBadge,
  tableClass, tdClass, theadClass, thClass, trClass,
} from "@/components/ui";

const KPIS = [
  { key: "candidates", label: "Candidates", icon: "users" },
  { key: "recruiters", label: "Recruiters", icon: "user" },
  { key: "companies", label: "Companies", icon: "building" },
  { key: "openJobs", label: "Open jobs", icon: "briefcase" },
  { key: "applications", label: "Applications", icon: "file" },
  { key: "offers", label: "Offers", icon: "gift" },
];

// A table inside a card runs edge to edge (no second border) and scrolls sideways on small screens.
const CARD_TABLE = "relative -mx-5 -mb-5 overflow-x-auto rounded-b-2xl border-t border-slate-200 sm:-mx-7 sm:-mb-7";

const pct = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

function DashboardSkeleton() {
  return <div className="space-y-6" role="status" aria-label="Loading dashboard">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {KPIS.map((k) => <div key={k.key} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card"><Skeleton className="h-7 w-12" /><Skeleton className="mt-2 h-3 w-20" /></div>)}
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      {[0, 1].map((i) => <div key={i} className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-card"><Skeleton className="h-4 w-40" />{[0, 1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-3" />)}</div>)}
    </div>
    <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-card"><Skeleton className="h-4 w-56" />{[0, 1, 2].map((j) => <Skeleton key={j} className="h-3" />)}</div>
    <span className="sr-only">Loading dashboard…</span>
  </div>;
}

function StageCard({ stages, total }) {
  return <Card title="Applications by stage" description={`${total} application${total === 1 ? "" : "s"} by current status`}>
    {total === 0 ? <EmptyState bare icon="file" title="No applications yet" message="Stage counts appear once candidates apply." />
      : <BarList ariaLabel="Applications by stage" items={stages.map((s) => ({
        key: s.status, label: s.status.charAt(0).toUpperCase() + s.status.slice(1), value: s.count,
        tone: s.status === "rejected" ? "danger" : "accent",
        tooltip: `${s.count} application${s.count === 1 ? "" : "s"} (${total ? Math.round((s.count / total) * 100) : 0}%)`,
      }))} />}
  </Card>;
}

function SkillsCard({ skills, minJobs }) {
  return <Card title="Top demanded skills" description={`Skills listed by at least ${minJobs} open jobs`}>
    {skills.length === 0 ? <EmptyState bare icon="sparkles" title="No skill is shared by open jobs yet" message={`A skill appears here once ${minJobs} or more open jobs ask for it.`} />
      : <BarList ariaLabel="Top demanded skills" labelWidth="w-32 sm:w-48" items={skills.map((s) => ({
        key: s.id, label: s.name, value: s.jobCount,
        tooltip: `${s.jobCount} open job${s.jobCount === 1 ? "" : "s"}, required in ${s.requiredCount}`,
      }))} />}
  </Card>;
}

function MatchCard({ rows }) {
  const scored = rows.filter((r) => r.avgMatchScore != null);
  return <Card title="Average match score by outcome"
    description="Mean resume-to-job cosine similarity (pgvector) for applications at each status. If semantic matching predicts outcomes, candidates who progress should score higher than those rejected.">
    {scored.length === 0 ? <EmptyState bare icon="chart" title="No scored applications yet" message="Scores appear once resumes and jobs are embedded and candidates apply." />
      : <>
        <BarList ariaLabel="Average match score by status" max={1} labelWidth="w-28 sm:w-36" items={rows.map((r) => ({
          key: r.status, label: r.status.charAt(0).toUpperCase() + r.status.slice(1), value: r.avgMatchScore,
          display: r.avgMatchScore == null ? "—" : r.avgMatchScore.toFixed(3),
          tone: r.status === "rejected" ? "danger" : "accent",
          tooltip: r.avgMatchScore == null ? "no scored applications"
            : `avg ${r.avgMatchScore.toFixed(4)} over ${r.scored} scored application${r.scored === 1 ? "" : "s"}`,
        }))} />
        <p className="mt-4 text-xs text-slate-500">
          Scale 0 to 1. Sample sizes: {rows.map((r) => `${r.status} ${r.scored}`).join(" · ")}. Small groups (n &lt; 5) are indicative only.
        </p>
      </>}
  </Card>;
}

function CompaniesTable({ companies, avg }) {
  return <Card title="Companies" description={`Above average = more applications than the platform average of ${avg ?? 0} per company. Acceptance rate = accepted ÷ (accepted + declined).`}
    actions={<Link href="/admin/companies" className={`${linkClass} text-sm`}>Manage companies</Link>}>
    {companies.length === 0 ? <EmptyState bare icon="building" title="No companies yet" message="Add a company to start posting jobs." />
      : <div className={CARD_TABLE}>
        <table className={tableClass}>
          <thead className={theadClass}><tr>
            <th className={thClass}>Company</th><th className={`${thClass} text-right`}>Jobs</th><th className={`${thClass} text-right`}>Applications</th>
            <th className={`${thClass} text-right`}>Offers</th><th className={`${thClass} text-right`}>Acceptance</th><th className={`${thClass} text-right`}>Avg interview rating</th>
          </tr></thead>
          <tbody>{companies.map((c) => <tr key={c.id} className={trClass}>
            <td className={`${tdClass} min-w-[15rem]`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{c.name}</span>
                {c.aboveAverage && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">Above average</span>}
              </div>
              <p className="text-xs text-slate-500">{c.industry || "—"}</p>
            </td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{c.jobs}<span className="text-slate-400"> · {c.openJobs} open</span></td>
            <td className={`${tdClass} whitespace-nowrap text-right font-medium tabular-nums`}>{c.applications}</td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{c.offersMade}</td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`} title={`${c.offersAccepted} accepted, ${c.offersDeclined} declined`}>
              {c.acceptanceRatePct == null ? <span className="text-slate-400">{c.offersMade ? "awaiting reply" : "—"}</span> : pct(c.acceptanceRatePct)}
            </td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
              {c.avgInterviewRating == null ? <span className="text-slate-400">—</span>
                : <span className="inline-flex items-center gap-1"><Icon name="star" className="h-3.5 w-3.5 text-amber-500" />{c.avgInterviewRating.toFixed(2)}<span className="text-xs text-slate-400">({c.ratedInterviews})</span></span>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
  </Card>;
}

function JobsTable({ jobs }) {
  return <Card title="Applications per job" description="From generate_hiring_pipeline_report(): current stage counts and the share of applications that ever reached shortlist / offer.">
    {jobs.length === 0 ? <EmptyState bare icon="briefcase" title="No jobs posted yet" />
      : <div className={CARD_TABLE}>
        <table className={tableClass}>
          <thead className={theadClass}><tr>
            <th className={thClass}>Job</th><th className={`${thClass} text-right`}>Applications</th>
            <th className={thClass}>Stages</th><th className={`${thClass} text-right`}>Shortlist rate</th><th className={`${thClass} text-right`}>Offer rate</th>
          </tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id} className={trClass}>
            <td className={`${tdClass} min-w-[14rem]`}><p className="font-medium text-slate-900">{j.title} <StatusBadge status={j.status} /></p><p className="text-xs text-slate-500">{j.company}</p></td>
            <td className={`${tdClass} whitespace-nowrap text-right font-medium tabular-nums`}>{j.applications}</td>
            <td className={`${tdClass} min-w-[17rem]`}>{j.applications === 0 ? <span className="text-xs text-slate-400">No applications yet</span>
              : <div className="flex flex-wrap gap-1">{["applied", "shortlisted", "interviewed", "offered", "rejected"].filter((s) => j[s] > 0)
                .map((s) => <span key={s} className="whitespace-nowrap" title={`${j[s]} ${s}`}><StatusBadge status={s} /><span className="ml-0.5 text-xs tabular-nums text-slate-600">{j[s]}</span></span>)}</div>}</td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{pct(j.shortlistRatePct)}</td>
            <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>{pct(j.offerRatePct)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </Card>;
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    request("/api/admin/dashboard").then((r) => {
      if (r.ok) setData(r.body); else setError(errorLines(r.body, "The dashboard could not be loaded."));
    });
  }, []);

  return <PageShell>
    <PageHeader title="Admin dashboard" description="Hiring activity across every company, computed live from the database views and the pipeline report function." />
    <Alert lines={error} />
    {!data ? !error && <DashboardSkeleton /> : <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {KPIS.map((k) => <KpiCard key={k.key} icon={k.icon} label={k.label} value={data.totals[k.key]}
          hint={k.key === "recruiters" && data.totals.activeRecruiters !== data.totals.recruiters ? `${data.totals.activeRecruiters} active`
            : k.key === "offers" ? `${data.totals.interviews} interviews` : undefined} />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <StageCard stages={data.applicationsByStage} total={data.totals.applications} />
        <SkillsCard skills={data.topSkills} minJobs={data.minJobsPerSkill} />
      </div>
      <MatchCard rows={data.matchScoreByStatus} />
      <CompaniesTable companies={data.companies} avg={data.avgApplicationsPerCompany} />
      <JobsTable jobs={data.jobs} />
    </>}
  </PageShell>;
}
