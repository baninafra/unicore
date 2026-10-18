// Repeticiones de eventos: de la regla iCalendar (RRULE) a un formulario y a una frase en español.

import { format } from "date-fns";
import { t, dateLocale } from "@/lib/i18n";

export type Freq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Recurrence {
  freq: Freq;
  interval: number;
  byDay: string[]; // "MO", "TU"… (semanal)
  monthMode: "day" | "nth"; // el día 14 / el segundo martes
  end: "never" | "until" | "count";
  until: string; // "2026-12-01"
  count: number;
}

export const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
export const DAY_SHORT: Record<string, string> = { MO: t("L"), TU: t("M"), WE: t("X"), TH: t("J"), FR: t("V"), SA: t("S"), SU: t("D") };
const DAY_NAME: Record<string, string> = { MO: t("lunes"), TU: t("martes"), WE: t("miércoles"), TH: t("jueves"), FR: t("viernes"), SA: t("sábados"), SU: t("domingos") };
const JS_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const NTH = ["", t("primer"), t("segundo"), t("tercer"), t("cuarto"), t("último")];

export const dayCodeOf = (d: Date) => JS_DAY[d.getDay()];

// Qué número de ese día de la semana es en el mes (1 a 4, o -1 si es el último).
export function nthOfMonth(d: Date): number {
  const n = Math.ceil(d.getDate() / 7);
  const nextWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  return nextWeek.getMonth() !== d.getMonth() && n >= 4 ? -1 : n;
}

export function emptyRecurrence(start: Date): Recurrence {
  return { freq: "NONE", interval: 1, byDay: [dayCodeOf(start)], monthMode: "day", end: "never", until: "", count: 10 };
}

export function parseRecurrence(rrule: string | undefined, start: Date): Recurrence {
  const r = emptyRecurrence(start);
  if (!rrule) return r;
  const kv: Record<string, string> = {};
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v) kv[k.toUpperCase()] = v;
  }
  if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(kv.FREQ)) r.freq = kv.FREQ as Freq;
  r.interval = Math.max(1, Number(kv.INTERVAL) || 1);
  if (kv.BYDAY) {
    const days = kv.BYDAY.split(",");
    if (r.freq === "WEEKLY") r.byDay = days.map((d) => d.replace(/^[+-]?\d+/, ""));
    if (r.freq === "MONTHLY" && /^[+-]?\d/.test(days[0])) r.monthMode = "nth";
  }
  if (kv.UNTIL) {
    const m = kv.UNTIL.match(/^(\d{4})(\d\d)(\d\d)/);
    if (m) {
      r.end = "until";
      r.until = `${m[1]}-${m[2]}-${m[3]}`;
    }
  } else if (kv.COUNT) {
    r.end = "count";
    r.count = Math.max(1, Number(kv.COUNT) || 1);
  }
  return r;
}

export function buildRRule(r: Recurrence, start: Date): string | undefined {
  if (r.freq === "NONE") return undefined;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY") {
    const days = r.byDay.length ? r.byDay : [dayCodeOf(start)];
    parts.push(`BYDAY=${DAY_CODES.filter((d) => days.includes(d)).join(",")}`);
  }
  if (r.freq === "MONTHLY") {
    if (r.monthMode === "nth") parts.push(`BYDAY=${nthOfMonth(start)}${dayCodeOf(start)}`);
    else parts.push(`BYMONTHDAY=${start.getDate()}`);
  }
  if (r.end === "until" && r.until) {
    const [y, m, d] = r.until.split("-").map(Number);
    const until = new Date(y, m - 1, d, 23, 59, 59);
    parts.push(`UNTIL=${until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  }
  if (r.end === "count") parts.push(`COUNT=${Math.max(1, r.count)}`);
  return parts.join(";");
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : t("{items} y {last}", { items: xs.slice(0, -1).join(", "), last: xs[xs.length - 1] }));

// "Cada semana los lunes y miércoles, hasta el 1 de dic."
export function describeRecurrence(rrule: string | undefined, start: Date): string {
  if (!rrule) return t("No se repite");
  const r = parseRecurrence(rrule, start);
  const n = r.interval;
  let text: string;
  switch (r.freq) {
    case "DAILY":
      text = n === 1 ? t("Todos los días") : t("Cada {n} días", { n });
      break;
    case "WEEKLY": {
      const days = DAY_CODES.filter((d) => r.byDay.includes(d));
      const workdays = days.length === 5 && !days.includes("SA") && !days.includes("SU");
      text = `${n === 1 ? t("Cada semana") : t("Cada {n} semanas", { n })} ${workdays ? t("de lunes a viernes") : t("los {dias}", { dias: list(days.map((d) => DAY_NAME[d])) })}`;
      break;
    }
    case "MONTHLY": {
      const nth = nthOfMonth(start);
      const which = r.monthMode === "nth" ? t("el {nth} {dia}", { nth: NTH[nth === -1 ? 5 : nth], dia: DAY_NAME[dayCodeOf(start)].replace(/s$/, "") }) : t("el día {dia}", { dia: start.getDate() });
      text = `${n === 1 ? t("Cada mes") : t("Cada {n} meses", { n })}, ${which}`;
      break;
    }
    case "YEARLY":
      text = `${n === 1 ? t("Cada año") : t("Cada {n} años", { n })}, ${t("el {fecha}", { fecha: format(start, t("d 'de' MMMM"), { locale: dateLocale() }) })}`;
      break;
    default:
      return t("No se repite");
  }
  if (r.end === "until" && r.until) {
    const [y, m, d] = r.until.split("-").map(Number);
    text += t(", hasta el {fecha}", { fecha: format(new Date(y, m - 1, d), t("d 'de' MMM yyyy"), { locale: dateLocale() }) });
  }
  if (r.end === "count") text += r.count === 1 ? t(", {n} vez", { n: r.count }) : t(", {n} veces", { n: r.count });
  return text;
}

export const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: t("Al empezar") },
  { value: 5, label: t("5 minutos antes") },
  { value: 10, label: t("10 minutos antes") },
  { value: 15, label: t("15 minutos antes") },
  { value: 30, label: t("30 minutos antes") },
  { value: 60, label: t("1 hora antes") },
  { value: 120, label: t("2 horas antes") },
  { value: 1440, label: t("1 día antes") },
  { value: 2880, label: t("2 días antes") },
  { value: 10080, label: t("1 semana antes") },
];

export function reminderLabel(min: number): string {
  const known = REMINDER_OPTIONS.find((o) => o.value === min);
  if (known) return known.label;
  if (min % 1440 === 0) return t("{n} días antes", { n: min / 1440 });
  if (min % 60 === 0) return t("{n} horas antes", { n: min / 60 });
  return t("{n} minutos antes", { n: min });
}
