"use client";

// Dashboard charts in plain HTML/CSS (no chart library).
// A horizontal bar is just a div whose width is value / max. Bars start at
// width 0 and transition to their real width after mount, show the exact
// value next to the bar, and reveal a tooltip on hover or keyboard focus.

import { Icon, useMounted } from "@/components/ui";

const TONES = {
  accent: "bg-gradient-to-r from-indigo-600 to-indigo-400",
  danger: "bg-gradient-to-r from-red-500 to-red-400",
  muted: "bg-slate-400",
};

// items: [{ key, label, value, display?, tone?, tooltip? }]
// max:   the value that fills the whole track (defaults to the largest value)
export function BarList({ items, max, ariaLabel, labelWidth = "w-28 sm:w-36" }) {
  const mounted = useMounted();
  const top = max ?? Math.max(1, ...items.map((i) => i.value ?? 0));
  return <ul className="space-y-3" aria-label={ariaLabel}>
    {items.map((item) => {
      const pct = item.value == null ? 0 : Math.max(0, Math.min(100, (item.value / top) * 100));
      const display = item.display ?? String(item.value ?? "—");
      return <li key={item.key} tabIndex={0}
        className="group relative flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        <span className={`${labelWidth} shrink-0 truncate text-sm text-slate-700`} title={item.label}>{item.label}</span>
        <span className="relative h-2.5 flex-1 rounded-full bg-slate-100">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${TONES[item.tone] || TONES.accent} group-hover:brightness-95`}
            style={{ width: mounted ? `${pct}%` : "0%", minWidth: item.value ? "4px" : 0 }}
          />
        </span>
        <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums text-slate-900">{display}</span>
        {/* Tooltip: shown on hover and on keyboard focus */}
        <span role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block group-focus-visible:block">
          <span className="font-medium">{item.label}</span>: {item.tooltip ?? display}
        </span>
      </li>;
    })}
  </ul>;
}

// KPI tile: icon, big number, muted label.
export function KpiCard({ icon, label, value, hint }) {
  return <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-sky-400" />
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100"><Icon name={icon} className="h-5 w-5" /></span>
    <div className="mt-3 min-w-0">
      <p className="text-3xl font-semibold tabular-nums tracking-[-0.02em] text-slate-900">{value}</p>
      <p className="mt-0.5 truncate text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  </div>;
}
