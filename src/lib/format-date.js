// One display format for every date in the app: "16 Oct 2026", and
// "16 Oct 2026, 8:49 pm" when the time matters. Used by the UI and by the
// server code that writes notification texts, so both always agree.
//
// Times are shown in India time (Asia/Kolkata), whatever the browser's or
// the server's time zone is: offer dates are Indian calendar dates in the
// database too (local_today(), migration 018). The month names are spelled
// out here instead of coming from the locale, because en-IN writes
// September as "Sept" and the result must not depend on the runtime.

const TIME_ZONE = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});

// Calendar parts of a moment in India time.
function indiaParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const p = Object.fromEntries(partsFormat.formatToParts(date).map(({ type, value: v }) => [type, v]));
  return { year: p.year, month: Number(p.month), day: Number(p.day), hour: p.hour, minute: p.minute, period: p.dayPeriod.toLowerCase() };
}

// "2026-11-16" (a DATE column: no time, no time zone) or a timestamp -> "16 Nov 2026".
export function formatDate(value) {
  if (value == null || value === "") return "";
  const plain = typeof value === "string" && DATE_ONLY.exec(value);
  if (plain) return `${Number(plain[3])} ${MONTHS[Number(plain[2]) - 1]} ${plain[1]}`;
  const p = indiaParts(value);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}` : "";
}

// A timestamp -> "16 Oct 2026, 8:49 pm" (India time).
export function formatDateTime(value) {
  if (value == null || value === "") return "";
  const p = indiaParts(value);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${p.hour}:${p.minute} ${p.period}` : "";
}
