// Lector de archivos iCalendar (.ics): eventos simples y repetidos (RRULE, EXDATE, cambios de una sola fecha).

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  location?: string;
  description?: string;
}

interface Prop {
  params: Record<string, string>;
  value: string;
}

// Nombres de zona horaria de Windows (los usa Outlook) a nombres IANA.
const WINDOWS_ZONES: Record<string, string> = {
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Pacific Standard Time": "America/Bogota",
  "Pacific SA Standard Time": "America/Santiago",
  "SA Western Standard Time": "America/La_Paz",
  "Montevideo Standard Time": "America/Montevideo",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "UTC": "UTC",
};

const DAY_MS = 86_400_000;
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeText(s: string): string {
  return s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const m = line.match(/^([A-Za-z0-9-]+)((?:;[^:]*)*):(.*)$/);
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const part of m[2].split(";").filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: m[1].toUpperCase(), prop: { params, value: m[3] } };
}

// Hora "de pared" en una zona (IANA) convertida a instante.
function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): Date | null {
  const tz = WINDOWS_ZONES[zone] ?? zone;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    const offsetAt = (t: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
    };
    let t = wall - offsetAt(wall);
    t = wall - offsetAt(t);
    return new Date(t);
  } catch {
    return null; // zona desconocida
  }
}

function parseDate(prop: Prop): { date: Date; allDay: boolean } | null {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return { date: new Date(y, mo - 1, d), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  const zone = prop.params.TZID;
  const zoned = zone ? zonedToDate(y, mo, d, h, mi, s, zone) : null;
  return { date: zoned ?? new Date(y, mo - 1, d, h, mi, s), allDay: false };
}

function parseDuration(v: string): number | null {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const n = (x?: string) => Number(x ?? 0);
  const ms = (n(m[2]) * 7 + n(m[3])) * DAY_MS + n(m[4]) * 3_600_000 + n(m[5]) * 60_000 + n(m[6]) * 1000;
  return m[1] === "-" ? -ms : ms;
}

interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
  byDay: { code: string; nth: number }[];
  byMonthDay: number[];
}

function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) kv[k.toUpperCase()] = v;
  }
  const freq = kv.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const until = kv.UNTIL ? parseDate({ params: {}, value: kv.UNTIL })?.date : undefined;
  return {
    freq,
    interval: Math.max(1, Number(kv.INTERVAL) || 1),
    count: kv.COUNT ? Number(kv.COUNT) : undefined,
    until: until ? (kv.UNTIL.length === 8 ? new Date(until.getTime() + DAY_MS - 1) : until) : undefined,
    byDay: (kv.BYDAY?.split(",") ?? []).flatMap((d) => {
      const m = d.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
      return m ? [{ code: m[2], nth: m[1] ? Number(m[1]) : 0 }] : [];
    }),
    byMonthDay: (kv.BYMONTHDAY?.split(",") ?? []).map(Number).filter((n) => n !== 0 && Number.isFinite(n)),
  };
}

// Mismo horario que `base` pero en otro día (en hora local).
function atDay(base: Date, y: number, m: number, d: number): Date {
  return new Date(y, m, d, base.getHours(), base.getMinutes(), base.getSeconds());
}

// Fechas de inicio de cada repetición, desde `first` hasta `limit`.
function expand(first: Date, rule: Rule, limit: Date): Date[] {
  const out: Date[] = [];
  const stop = rule.until && rule.until < limit ? rule.until : limit;
  const push = (d: Date) => {
    if (d < first || d > stop) return false;
    out.push(d);
    return !(rule.count && out.length >= rule.count);
  };

  for (let k = 0; k < 6000; k++) {
    const i = k * rule.interval;
    let batch: Date[] = [];
    let periodStart: Date;

    if (rule.freq === "DAILY") {
      periodStart = atDay(first, first.getFullYear(), first.getMonth(), first.getDate() + i);
      batch = [periodStart];
    } else if (rule.freq === "WEEKLY") {
      const monday = first.getDate() - ((first.getDay() + 6) % 7) + i * 7;
      periodStart = atDay(first, first.getFullYear(), first.getMonth(), monday);
      const codes = rule.byDay.length ? rule.byDay.map((b) => b.code) : [DAY_CODES[first.getDay()]];
      batch = codes
        .map((c) => (DAY_CODES.indexOf(c) + 6) % 7)
        .sort((a, b) => a - b)
        .map((off) => atDay(first, first.getFullYear(), first.getMonth(), monday + off));
    } else if (rule.freq === "MONTHLY") {
      const y = first.getFullYear();
      const mo = first.getMonth() + i;
      periodStart = atDay(first, y, mo, 1);
      const lastDay = new Date(y, mo + 1, 0).getDate();
      const days = new Set<number>();
      if (rule.byDay.length) {
        for (const { code, nth } of rule.byDay) {
          const dow = DAY_CODES.indexOf(code);
          const all = Array.from({ length: lastDay }, (_, n) => n + 1).filter((n) => new Date(y, mo, n).getDay() === dow);
          if (nth === 0) all.forEach((n) => days.add(n));
          else {
            const pick = nth > 0 ? all[nth - 1] : all[all.length + nth];
            if (pick) days.add(pick);
          }
        }
      } else if (rule.byMonthDay.length) {
        for (const n of rule.byMonthDay) {
          const day = n > 0 ? n : lastDay + n + 1;
          if (day >= 1 && day <= lastDay) days.add(day);
        }
      } else if (first.getDate() <= lastDay) days.add(first.getDate());
      batch = [...days].sort((a, b) => a - b).map((n) => atDay(first, y, mo, n));
    } else {
      const y = first.getFullYear() + i;
      periodStart = atDay(first, y, first.getMonth(), 1);
      if (new Date(y, first.getMonth() + 1, 0).getDate() >= first.getDate()) batch = [atDay(first, y, first.getMonth(), first.getDate())];
    }

    if (periodStart > stop) break;
    for (const d of batch) {
      if (d > stop) return out;
      if (d < first) continue;
      if (!push(d)) return out;
    }
  }
  return out;
}

// Devuelve los eventos del calendario que caen entre `from` y `to` (con las repeticiones ya abiertas).
export function parseIcs(text: string, from: Date, to: Date): IcsEvent[] {
  const lines = unfold(text);
  const blocks: Record<string, Prop[]>[] = [];
  let current: Record<string, Prop[]> | null = null;
  let depth = 0; // VALARM y similares dentro del evento

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, prop } = parsed;
    if (name === "BEGIN") {
      if (prop.value.toUpperCase() === "VEVENT" && !current) current = {};
      else if (current) depth++;
    } else if (name === "END") {
      if (prop.value.toUpperCase() === "VEVENT" && current && depth === 0) {
        blocks.push(current);
        current = null;
      } else if (current) depth--;
    } else if (current && depth === 0) {
      (current[name] ??= []).push(prop);
    }
  }

  // Cambios de una sola fecha de un evento repetido: se reemplaza esa repetición.
  const overridden = new Set<string>();
  for (const b of blocks) {
    const rid = b["RECURRENCE-ID"]?.[0];
    const parsed = rid && parseDate(rid);
    if (parsed) overridden.add(`${b.UID?.[0]?.value}|${parsed.date.getTime()}`);
  }

  const out: IcsEvent[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const b of blocks) {
    if (b.STATUS?.[0]?.value.toUpperCase() === "CANCELLED") continue;
    const startProp = b.DTSTART?.[0];
    const startParsed = startProp && parseDate(startProp);
    if (!startParsed) continue;
    const { date: start, allDay } = startParsed;

    let endDate: Date | undefined;
    const endProp = b.DTEND?.[0];
    const durProp = b.DURATION?.[0];
    if (endProp) endDate = parseDate(endProp)?.date;
    else if (durProp) {
      const ms = parseDuration(durProp.value);
      if (ms !== null) endDate = new Date(start.getTime() + ms);
    }
    if (!endDate && allDay) endDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const length = endDate ? Math.max(0, endDate.getTime() - start.getTime()) : 0;

    const uid = b.UID?.[0]?.value ?? `${start.getTime()}-${b.SUMMARY?.[0]?.value ?? ""}`;
    const base = {
      uid,
      title: unescapeText(b.SUMMARY?.[0]?.value ?? "").trim() || "Sin título",
      allDay,
      location: unescapeText(b.LOCATION?.[0]?.value ?? "").trim() || undefined,
      description: unescapeText(b.DESCRIPTION?.[0]?.value ?? "").trim() || undefined,
    };

    const emit = (s: Date) => {
      const e = length ? new Date(s.getTime() + length) : undefined;
      if ((e ?? s).getTime() < fromMs || s.getTime() > toMs) return;
      out.push({ ...base, start: s, end: e });
    };

    const rule = b.RRULE?.[0] && !b["RECURRENCE-ID"] ? parseRule(b.RRULE[0].value) : null;
    if (!rule) {
      emit(start);
      continue;
    }

    const excluded = new Set<number>();
    for (const ex of b.EXDATE ?? []) {
      for (const v of ex.value.split(",")) {
        const d = parseDate({ params: ex.params, value: v });
        if (d) excluded.add(d.date.getTime());
      }
    }
    for (const s of expand(start, rule, to)) {
      const t = s.getTime();
      if (excluded.has(t) || overridden.has(`${uid}|${t}`)) continue;
      emit(s);
    }
  }

  return out;
}
