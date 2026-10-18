"use client";

// Asistente de bienvenida: la primera vez (base vacía) hace unas preguntas y deja armados los perfiles,
// los espacios (carrera, trabajo, proyectos…) con lo que tienen adentro, el horario de trabajo y las preferencias.
// También se usa para sumar un perfil nuevo más adelante ("agregar") o para volver a hacer las preguntas.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db, newId, nowIso } from "@/lib/db";
import { seedIfEmpty } from "@/lib/seed";
import { createLocalCalendar, saveEvent } from "@/lib/calendars/events";
import { DAY_CODES, DAY_SHORT, dayCodeOf } from "@/lib/calendars/recurrence";
import { newProfile, PROFILE_KINDS, PROFILES, readProfile, useProfiles, writeProfile, type Profile, type ProfileKind } from "@/lib/profiles";
import type { Degree, DegreeColor, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings/apply-settings";
import { LogoMark } from "@/components/ui/logo";
import { toast } from "@/lib/undo";

export type OnboardingMode = "inicio" | "agregar" | "rehacer";

const EVENT = "uc:onboarding";
export function openOnboarding(mode: OnboardingMode = "agregar") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

interface Answers {
  name: string;
  kinds: ProfileKind[];
  profileNames: Partial<Record<ProfileKind, string>>;
  uni: { carrera: string; institucion: string; anios: string; anio: string; materias: string[] };
  colegio: { escuela: string; curso: string; materias: string[] };
  trabajo: { empresa: string; puesto: string; proyectos: string[]; dias: string[]; desde: string; hasta: string };
  proyectos: { espacio: string; proyectos: string[] };
  personal: { areas: string[] };
  theme: "dark" | "light";
  weekStart: "lun" | "dom";
  flashcards: boolean;
  about: string;
}

const EMPTY: Answers = {
  name: "",
  kinds: [],
  profileNames: {},
  uni: { carrera: "", institucion: "", anios: "5", anio: "1", materias: [] },
  colegio: { escuela: "", curso: "", materias: [] },
  trabajo: { empresa: "", puesto: "", proyectos: [], dias: ["MO", "TU", "WE", "TH", "FR"], desde: "09:00", hasta: "18:00" },
  proyectos: { espacio: "", proyectos: [] },
  personal: { areas: [] },
  theme: "dark",
  weekStart: "lun",
  flashcards: true,
  about: "",
};

// ---------- Crear todo ----------

// "Ingeniería en Sistemas" → "IS"; siempre entre 2 y 8 letras.
function initials(name: string): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const big = words.filter((w) => w.length > 2 || /\d/.test(w));
  let out = (big.length >= 2 ? big : words).map((w) => w[0]).join("").toUpperCase().slice(0, 8);
  if (out.length < 2) out = (words[0] ?? "ESP").slice(0, 4).toUpperCase().padEnd(2, "X");
  return out;
}

const semesterNow = (): 1 | 2 => (new Date().getMonth() < 7 ? 1 : 2);

function degree(kind: ProfileKind, name: string, color: DegreeColor, extra: Partial<Degree> = {}): Degree {
  return { id: newId(), name, shortName: initials(name), color, totalYears: 1, kind, createdAt: nowIso(), ...extra };
}

function items(degreeId: string, names: string[], extra: Partial<Subject> = {}): Subject[] {
  return names.map((name) => ({
    id: newId(),
    degreeId,
    name,
    year: 1,
    semester: 1,
    status: "CURSANDO",
    correlatives: [],
    createdAt: nowIso(),
    ...extra,
  }));
}

// Próximo día (desde hoy) que cae en alguno de los días elegidos.
function nextWorkday(days: string[], time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  for (let i = 0; i < 7 && !days.includes(dayCodeOf(d)); i++) d.setDate(d.getDate() + 1);
  return d;
}

// Arma los espacios de cada perfil recién creado (con lo que tienen adentro) y el horario de trabajo.
async function createFromAnswers(a: Answers, profiles: Profile[]): Promise<string[]> {
  const kinds = profiles.map((p) => p.kind);
  const profileId = (k: ProfileKind) => profiles.find((p) => p.kind === k)?.id;
  // Trabajo, proyectos y personal son un solo espacio con el nombre del perfil.
  const profileName = (k: ProfileKind) => profiles.find((p) => p.kind === k)?.name ?? PROFILES[k].label;
  const degrees: Degree[] = [];
  const subjects: Subject[] = [];
  const facts: string[] = [];
  const colors: DegreeColor[] = ["primary", "cyan"];
  const color = () => colors[degrees.length % 2];

  for (const kind of kinds) {
    if (kind === "universidad" && a.uni.carrera.trim()) {
      const years = Math.min(10, Math.max(1, Number(a.uni.anios) || 5));
      const year = Math.min(years, Math.max(1, Number(a.uni.anio) || 1));
      const d = degree(kind, a.uni.carrera.trim(), color(), { totalYears: years, institution: a.uni.institucion.trim() || undefined, profileId: profileId(kind) });
      degrees.push(d);
      subjects.push(...items(d.id, a.uni.materias, { year, semester: semesterNow() }));
      facts.push(`Estudia ${d.name}${d.institution ? ` en ${d.institution}` : ""} (cursa ${year}.º año).`);
    }
    if (kind === "colegio" && (a.colegio.curso.trim() || a.colegio.escuela.trim())) {
      const name = a.colegio.curso.trim() || a.colegio.escuela.trim();
      const d = degree(kind, name, color(), { institution: a.colegio.escuela.trim() || undefined, profileId: profileId(kind) });
      degrees.push(d);
      subjects.push(...items(d.id, a.colegio.materias));
      facts.push(`Va al colegio: ${name}${a.colegio.escuela.trim() && a.colegio.curso.trim() ? ` en ${a.colegio.escuela.trim()}` : ""}.`);
    }
    if (kind === "trabajo") {
      const d = degree(kind, profileName(kind), color(), { profileId: profileId(kind) });
      degrees.push(d);
      subjects.push(...items(d.id, a.trabajo.proyectos));
      if (a.trabajo.empresa.trim() || a.trabajo.puesto.trim())
        facts.push(`Trabaja${a.trabajo.empresa.trim() ? ` en ${a.trabajo.empresa.trim()}` : ""}${a.trabajo.puesto.trim() ? ` como ${a.trabajo.puesto.trim()}` : ""}.`);
    }
    if (kind === "proyectos") {
      const d = degree(kind, profileName(kind), color(), { profileId: profileId(kind) });
      degrees.push(d);
      subjects.push(...items(d.id, a.proyectos.proyectos));
      if (a.proyectos.proyectos.length) facts.push(`Tiene proyectos propios: ${a.proyectos.proyectos.join(", ")}.`);
    }
    if (kind === "personal") {
      const d = degree(kind, profileName(kind), color(), { profileId: profileId(kind) });
      degrees.push(d);
      subjects.push(...items(d.id, a.personal.areas));
    }
  }

  await db.transaction("rw", db.degrees, db.subjects, async () => {
    if (degrees.length) await db.degrees.bulkAdd(degrees);
    if (subjects.length) await db.subjects.bulkAdd(subjects);
  });

  // Horario laboral: un evento que se repite cada semana en un calendario "Trabajo".
  const work = a.trabajo;
  if (kinds.includes("trabajo") && work.dias.length && work.desde < work.hasta) {
    const start = nextWorkday(work.dias, work.desde);
    const [h, m] = work.hasta.split(":").map(Number);
    const end = new Date(start);
    end.setHours(h || 0, m || 0, 0, 0);
    const calendarId = await createLocalCalendar("Trabajo");
    await saveEvent({
      calendarId,
      title: `Trabajo · ${work.empresa.trim() || profileName("trabajo")}`,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      category: "OTRO",
      rrule: `FREQ=WEEKLY;BYDAY=${DAY_CODES.filter((d) => work.dias.includes(d)).join(",")}`,
    });
  }
  return facts;
}

// ---------- Piezas ----------

// Con `group` (botones o listas adentro) no es un <label>: un clic en el título no tiene que tocar el primer botón.
function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: React.ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="flex flex-col gap-1.5">
      <span className="t-small font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[length:calc(12px*var(--ui-scale,1))] text-faint">{hint}</span>}
    </Tag>
  );
}

// Lista de nombres: se escribe y Enter (o coma) agrega; las sugerencias se agregan con un clic.
function ChipInput({ value, onChange, placeholder, suggestions = [], autoFocus }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[]; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLocaleLowerCase("es-AR") === p.toLocaleLowerCase("es-AR"))) next.push(p);
    onChange(next);
    setText("");
  };
  const left = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="flex flex-col gap-2">
      <div className="input flex h-auto min-h-9 flex-wrap items-center gap-1.5 py-1.5">
        {value.map((v) => (
          <span key={v} className="tag flex items-center gap-1">
            {v}
            <button type="button" aria-label={`Sacar ${v}`} className="text-faint hover:text-text" onClick={() => onChange(value.filter((x) => x !== v))}>
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          className="min-w-[140px] flex-1 bg-transparent outline-none"
          autoFocus={autoFocus}
          value={text}
          placeholder={value.length ? "Agregar otra…" : placeholder}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              e.stopPropagation();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {left.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {left.map((s) => (
            <button key={s} type="button" className="btn btn-sm" onClick={() => onChange([...value, s])}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Pasos ----------

type Step = "bienvenida" | "perfiles" | ProfileKind | "preferencias" | "listo";

function Heading({ title, sub, big }: { title: string; sub?: string; big?: boolean }) {
  return (
    <div className={clsx("flex flex-col", big ? "gap-2" : "gap-1")}>
      <h2 className={clsx("font-semibold", big ? "t-h1" : "t-h2")}>{title}</h2>
      {sub && <p className={clsx("text-muted", big ? "t-body" : "t-small")}>{sub}</p>}
    </div>
  );
}

function KindStep({ kind, a, set }: { kind: ProfileKind; a: Answers; set: (patch: Partial<Answers>) => void }) {
  switch (kind) {
    case "universidad": {
      const u = a.uni;
      const up = (p: Partial<Answers["uni"]>) => set({ uni: { ...u, ...p } });
      return (
        <>
          <Heading big title="Tu carrera" sub="Con esto armamos tu plan. Las demás materias las podés sumar después." />
          <Field label="¿Qué carrera estudiás?">
            <input className="input" autoFocus value={u.carrera} onChange={(e) => up({ carrera: e.target.value })} placeholder="Ingeniería en Sistemas" />
          </Field>
          <Field label="¿Dónde?">
            <input className="input" value={u.institucion} onChange={(e) => up({ institucion: e.target.value })} placeholder="Universidad, facultad o instituto" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="¿Cuántos años dura?">
              <input className="input" inputMode="numeric" value={u.anios} onChange={(e) => up({ anios: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            </Field>
            <Field label="¿Qué año estás cursando?">
              <input className="input" inputMode="numeric" value={u.anio} onChange={(e) => up({ anio: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            </Field>
          </div>
          <Field group label="¿Qué materias cursás ahora?" hint="Escribí una y apretá Enter.">
            <ChipInput value={u.materias} onChange={(materias) => up({ materias })} placeholder="Álgebra, Análisis Matemático I…" />
          </Field>
        </>
      );
    }
    case "colegio": {
      const c = a.colegio;
      const up = (p: Partial<Answers["colegio"]>) => set({ colegio: { ...c, ...p } });
      return (
        <>
          <Heading big title="Tu colegio" sub="Secundario, terciario o instituto." />
          <div className="grid grid-cols-2 gap-4">
            <Field label="¿Qué curso?">
              <input className="input" autoFocus value={c.curso} onChange={(e) => up({ curso: e.target.value })} placeholder="5.º año B" />
            </Field>
            <Field label="¿En qué escuela?">
              <input className="input" value={c.escuela} onChange={(e) => up({ escuela: e.target.value })} placeholder="Opcional" />
            </Field>
          </div>
          <Field group label="¿Qué materias tenés?" hint="Escribí una y apretá Enter, o tocá las sugerencias.">
            <ChipInput
              value={c.materias}
              onChange={(materias) => up({ materias })}
              placeholder="Matemática, Historia…"
              suggestions={["Matemática", "Lengua y Literatura", "Historia", "Geografía", "Biología", "Física", "Química", "Inglés", "Educación Física"]}
            />
          </Field>
        </>
      );
    }
    case "trabajo": {
      const w = a.trabajo;
      const up = (p: Partial<Answers["trabajo"]>) => set({ trabajo: { ...w, ...p } });
      return (
        <>
          <Heading big title="Tu trabajo" sub="Tus proyectos van a tener sus notas, tareas, reuniones y archivos." />
          <div className="grid grid-cols-2 gap-4">
            <Field label="¿Dónde trabajás?">
              <input className="input" autoFocus value={w.empresa} onChange={(e) => up({ empresa: e.target.value })} placeholder="Empresa, estudio u organismo" />
            </Field>
            <Field label="¿Qué hacés?">
              <input className="input" value={w.puesto} onChange={(e) => up({ puesto: e.target.value })} placeholder="Puesto o rol" />
            </Field>
          </div>
          <Field group label="¿En qué proyectos o áreas estás ahora?" hint="Escribí uno y apretá Enter.">
            <ChipInput value={w.proyectos} onChange={(proyectos) => up({ proyectos })} placeholder="Lanzamiento web, Clientes, Informes mensuales…" />
          </Field>
          <Field group label="¿Qué días y en qué horario trabajás?" hint="Lo agregamos al calendario. Si no tenés horario fijo, desmarcá todos los días.">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1">
                {DAY_CODES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={w.dias.includes(d)}
                    onClick={() => up({ dias: w.dias.includes(d) ? w.dias.filter((x) => x !== d) : [...w.dias, d] })}
                    className="btn btn-sm w-8 justify-center px-0 aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
                  >
                    {DAY_SHORT[d]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="time" className="input w-[110px]" value={w.desde} onChange={(e) => up({ desde: e.target.value })} aria-label="Desde" />
                <span className="t-small text-faint">a</span>
                <input type="time" className="input w-[110px]" value={w.hasta} onChange={(e) => up({ hasta: e.target.value })} aria-label="Hasta" />
              </div>
            </div>
          </Field>
        </>
      );
    }
    case "proyectos": {
      const p = a.proyectos;
      const up = (x: Partial<Answers["proyectos"]>) => set({ proyectos: { ...p, ...x } });
      return (
        <>
          <Heading big title="Tus proyectos" sub="Freelance, un emprendimiento, algo que estás armando por tu cuenta…" />
          <Field group label="¿En qué proyectos estás?" hint="Escribí uno y apretá Enter.">
            <ChipInput value={p.proyectos} onChange={(proyectos) => up({ proyectos })} placeholder="App de recetas, Cliente Pérez, Canal de YouTube…" autoFocus />
          </Field>
        </>
      );
    }
    case "personal":
      return (
        <>
          <Heading big title="Tu vida personal" sub="Cada área tiene sus notas, pendientes y metas." />
          <Field group label="¿Qué querés organizar?" hint="Tocá las que te sirvan o escribí otras.">
            <ChipInput
              value={a.personal.areas}
              onChange={(areas) => set({ personal: { areas } })}
              placeholder="Salud, Finanzas…"
              suggestions={["Salud", "Finanzas", "Hogar", "Deporte", "Lectura", "Viajes", "Trámites", "Idiomas"]}
            />
          </Field>
        </>
      );
  }
}

// ---------- Asistente ----------

// Nombre que se propone para el perfil según lo que contestó.
function suggestedName(kind: ProfileKind, a: Answers): string {
  switch (kind) {
    case "universidad":
      return "Facultad";
    case "colegio":
      return "Colegio";
    case "trabajo":
      return a.trabajo.empresa.trim() || "Trabajo";
    case "proyectos":
      return "Proyectos";
    case "personal":
      return "Personal";
  }
}

const STEP_LABEL: Record<Exclude<Step, ProfileKind>, string> = {
  bienvenida: "Bienvenida",
  perfiles: "Perfiles",
  preferencias: "Preferencias",
  listo: "Listo",
};
const stepLabel = (s: Step) => (PROFILE_KINDS.includes(s as ProfileKind) ? PROFILES[s as ProfileKind].label : STEP_LABEL[s as Exclude<Step, ProfileKind>]);

function Wizard({ mode, onClose }: { mode: OnboardingMode; onClose: () => void }) {
  const { theme, toggleTheme } = useAppState();
  const [settings, updateSettings] = useSettings();
  const { profile } = useProfiles();
  const [a, setA] = useState<Answers>(() => ({ ...EMPTY, name: profile.name, theme }));
  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }));
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const kinds = PROFILE_KINDS.filter((k) => a.kinds.includes(k));
  const steps: Step[] = mode === "agregar" ? ["perfiles", ...kinds, "listo"] : ["bienvenida", "perfiles", ...kinds, "preferencias", "listo"];
  const step = steps[Math.min(index, steps.length - 1)];
  const study = kinds.some((k) => PROFILES[k].study);
  const full = mode === "inicio";

  const canNext = step !== "perfiles" || kinds.length > 0;
  const next = () => canNext && setIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const nameOf = (k: ProfileKind) => a.profileNames[k]?.trim() || suggestedName(k, a);

  async function finish(sample = false) {
    setBusy(true);
    try {
      const current = readProfile();
      if (sample) {
        await seedIfEmpty();
        writeProfile({ name: a.name.trim(), profiles: [newProfile("universidad", "Facultad")], active: "todos", onboarded: true });
        onClose();
        return;
      }
      const created = kinds.map((k) => newProfile(k, nameOf(k)));
      const facts = await createFromAnswers(a, created);
      const keep = mode === "inicio" ? [] : current.profiles;
      const about = [mode === "inicio" ? "" : current.about, ...facts, mode === "agregar" ? "" : a.about.trim()].filter(Boolean).join(" ");
      const profiles = [...keep, ...created];
      writeProfile({
        name: mode === "agregar" ? current.name : a.name.trim() || current.name,
        profiles,
        active: created.length === 1 && mode !== "inicio" ? created[0].id : profiles.length > 1 ? "todos" : (profiles[0]?.id ?? "todos"),
        about,
        onboarded: true,
      });
      if (mode !== "agregar") {
        if (a.theme !== theme) toggleTheme();
        updateSettings({ weekStart: a.weekStart, notifReview: study && a.flashcards });
      }
      if (mode !== "inicio") toast(created.length === 1 ? `Listo, creamos el perfil «${created[0].name}»` : "Listo, creamos tus perfiles");
      onClose();
    } catch (e) {
      console.error(e);
      toast("No pudimos guardar todo. Probá de nuevo.", { tone: "error" });
      setBusy(false);
    }
  }

  // Enter en un campo avanza (las listas y los textos largos lo usan para otra cosa).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key !== "Enter" || e.shiftKey || tag !== "INPUT") return;
    e.preventDefault();
    if (step === "listo") void finish();
    else next();
  };

  const summary = kinds.map((k) => {
    const def = PROFILES[k];
    const list =
      k === "universidad" ? a.uni.materias : k === "colegio" ? a.colegio.materias : k === "trabajo" ? a.trabajo.proyectos : k === "proyectos" ? a.proyectos.proyectos : a.personal.areas;
    const space =
      k === "universidad" ? a.uni.carrera : k === "colegio" ? a.colegio.curso || a.colegio.escuela : k === "trabajo" ? a.trabajo.empresa : k === "proyectos" ? a.proyectos.espacio || (list.length ? "Proyectos propios" : "") : list.length ? "Personal" : "";
    return { def, name: nameOf(k), space: space.trim(), list };
  });

  const body = (
    <div className="flex flex-col gap-6" onKeyDown={onKeyDown}>
      {step === "bienvenida" && (
        <>
          <Heading
            big={full}
            title="Te damos la bienvenida"
            sub="Te hacemos unas preguntas cortas para dejar la app armada a tu medida: para estudiar, trabajar, tus proyectos o todo junto. Tarda un minuto y después podés cambiar lo que quieras."
          />
          <Field label="¿Cómo te llamás?">
            <input className="input h-11 text-[length:calc(15px*var(--ui-scale,1))]" autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Tu nombre" />
          </Field>
        </>
      )}

      {step === "perfiles" && (
        <>
          <Heading
            big={full}
            title={mode === "agregar" ? "¿Qué perfil querés crear?" : `${a.name.trim() ? `${a.name.trim().split(" ")[0]}, ¿p` : "¿P"}ara qué vas a usar UniCore?`}
            sub={
              mode === "agregar"
                ? "Podés tener varios del mismo tipo, por ejemplo dos trabajos. En el próximo paso le ponés nombre."
                : "Elegí todos los que quieras: cada uno se vuelve un perfil con su nombre. Después vas a poder crear más, incluso varios del mismo tipo."
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {PROFILE_KINDS.map((k) => {
              const def = PROFILES[k];
              const on = a.kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setA((prev) => ({ ...prev, kinds: prev.kinds.includes(k) ? prev.kinds.filter((x) => x !== k) : [...prev.kinds, k] }))}
                  className={clsx(
                    "flex items-start gap-3.5 rounded-lg border p-4 text-left transition-colors",
                    on ? "border-primary bg-primary-tint" : "border-border bg-surface hover:border-border-strong hover:bg-surface-raised",
                  )}
                >
                  <span className={clsx("flex h-10 w-10 flex-none items-center justify-center rounded-md", on ? "bg-primary text-white" : "bg-surface-raised text-muted")}>
                    <def.icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="t-h3 font-semibold text-text">{def.label}</span>
                    <span className="t-small text-muted">{def.blurb}</span>
                  </span>
                  <span className={clsx("mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border", on ? "border-primary bg-primary text-white" : "border-border-strong")}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {PROFILE_KINDS.includes(step as ProfileKind) && (
        <>
          <KindStep kind={step as ProfileKind} a={a} set={set} />
          <Field label="Nombre del perfil" hint="Así lo vas a ver arriba de Archivos para cambiar de un perfil a otro.">
            <input
              className="input"
              value={a.profileNames[step as ProfileKind] ?? ""}
              onChange={(e) => set({ profileNames: { ...a.profileNames, [step]: e.target.value } })}
              placeholder={suggestedName(step as ProfileKind, a)}
            />
          </Field>
        </>
      )}

      {step === "preferencias" && (
        <>
          <Heading big={full} title="Últimos detalles" sub="Cómo querés que se vea y qué querés que sepa la IA de vos." />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field group label="Tema">
              <Choice value={a.theme} options={[{ value: "dark", label: "Oscuro" }, { value: "light", label: "Claro" }]} onChange={(theme) => set({ theme })} />
            </Field>
            <Field group label="La semana empieza el">
              <Choice value={a.weekStart} options={[{ value: "lun", label: "Lunes" }, { value: "dom", label: "Domingo" }]} onChange={(weekStart) => set({ weekStart })} />
            </Field>
          </div>
          <Field group label="Tamaño del texto" hint="Se aplica al instante, así ves cómo queda.">
            <Choice
              value={String(settings.uiFont)}
              options={[
                { value: "13", label: "Chico" },
                { value: "15", label: "Normal" },
                { value: "17", label: "Grande" },
                { value: "19", label: "Muy grande" },
              ]}
              onChange={(v) => updateSettings({ uiFont: Number(v), editorFont: Number(v) + 2 })}
            />
          </Field>
          {study && (
            <Field group label="¿Querés que te avisemos cuando tengas flashcards para repasar?">
              <Choice value={a.flashcards ? "si" : "no"} options={[{ value: "si", label: "Sí" }, { value: "no", label: "No" }]} onChange={(v) => set({ flashcards: v === "si" })} />
            </Field>
          )}
          <Field label="Contale a la IA sobre vos (opcional)" hint="Qué hacés, qué querés lograr, cómo te gusta que te expliquen. La IA lo tiene en cuenta en cada respuesta.">
            <textarea
              className="input min-h-[96px] py-2"
              value={a.about}
              onChange={(e) => set({ about: e.target.value })}
              placeholder="Ej.: trabajo de mañana y curso de noche, quiero recibirme el año que viene, prefiero explicaciones con ejemplos."
            />
          </Field>
        </>
      )}

      {step === "listo" && (
        <>
          <Heading big={full} title="Todo listo" sub="Esto es lo que vamos a armar. Lo podés cambiar cuando quieras desde Ajustes → Perfiles." />
          <div className="flex flex-col gap-2.5">
            {summary.map(({ def, name, space, list }) => (
              <div key={def.kind} className="flex items-start gap-3.5 rounded-lg border border-border bg-surface p-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary-tint text-primary-soft">
                  <def.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="t-h3 font-semibold">
                    {name}
                    <span className="t-small font-normal text-faint"> · perfil {def.label.toLowerCase()}</span>
                  </span>
                  <span className="t-small text-muted">
                    {!def.study
                      ? list.length
                        ? `${list.length} ${list.length === 1 ? def.item.one : def.item.many}: ${list.join(", ")}`
                        : `Sin ${def.item.many} por ahora; los sumás cuando quieras`
                      : space
                        ? `${space}${list.length ? ` · ${list.length} ${list.length === 1 ? def.item.one : def.item.many}: ${list.join(", ")}` : ""}`
                        : `${def.space.f ? "La" : "El"} ${def.space.one} lo cargás después`}
                  </span>
                </div>
              </div>
            ))}
            {kinds.includes("trabajo") && a.trabajo.dias.length > 0 && a.trabajo.desde < a.trabajo.hasta && (
              <p className="t-small text-muted">
                Horario de trabajo en el calendario: {a.trabajo.dias.map((d) => DAY_SHORT[d]).join(" ")} de {a.trabajo.desde} a {a.trabajo.hasta}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center gap-2">
      {step === "bienvenida" ? (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void finish(true)} title="Carga una carrera de ejemplo con materias y tareas">
            Probar con datos de ejemplo
          </button>
          <button type="button" className="btn btn-primary ml-auto h-10 px-5" onClick={next}>
            Empezar
            <ArrowRight strokeWidth={1.75} />
          </button>
        </>
      ) : (
        <>
          {index > 0 ? (
            <button type="button" className="btn h-10" onClick={back} disabled={busy}>
              <ArrowLeft strokeWidth={1.75} />
              Atrás
            </button>
          ) : (
            <button type="button" className="btn h-10" onClick={onClose}>
              Cancelar
            </button>
          )}
          {PROFILE_KINDS.includes(step as ProfileKind) && <span className="t-small ml-2 hidden text-faint sm:inline">Podés dejar vacío lo que no sepas</span>}
          {step === "listo" ? (
            <button type="button" className="btn btn-primary ml-auto h-10 px-5" disabled={busy || kinds.length === 0} onClick={() => void finish()}>
              {mode === "agregar" ? (kinds.length === 1 ? "Crear perfil" : "Crear perfiles") : "Abrir UniCore"}
              <Check strokeWidth={1.75} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary ml-auto h-10 px-5" disabled={!canNext} onClick={next}>
              Siguiente
              <ArrowRight strokeWidth={1.75} />
            </button>
          )}
        </>
      )}
    </div>
  );

  // Ventana chica (crear un perfil más adelante): barra de progreso arriba y nada más.
  if (!full) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-1.5" aria-label={`Paso ${index + 1} de ${steps.length}`}>
          {steps.map((s, i) => (
            <span key={`${s}-${i}`} className={clsx("h-1 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-border")} />
          ))}
        </div>
        {body}
        {footer}
      </div>
    );
  }

  // Primera vez: toda la ventana, con los pasos a la izquierda y el formulario centrado a la derecha.
  return (
    <div className="flex h-full min-h-0 w-full">
      <aside data-tauri-drag-region className="hidden w-[min(36%,440px)] flex-none flex-col justify-between border-r border-border bg-surface px-10 py-12 lg:flex">
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-3">
            <LogoMark size={36} />
            <span className="t-h2 font-semibold">UniCore</span>
          </div>
          <ol className="flex flex-col gap-1">
            {steps.map((s, i) => {
              const done = i < index;
              const current = i === index;
              return (
                <li key={`${s}-${i}`} className={clsx("flex items-center gap-3 rounded-md px-2 py-2", current && "bg-surface-raised")}>
                  <span
                    className={clsx(
                      "flex h-6 w-6 flex-none items-center justify-center rounded-full border text-[length:calc(12px*var(--ui-scale,1))] font-semibold",
                      done ? "border-primary bg-primary text-white" : current ? "border-primary text-primary-soft" : "border-border-strong text-faint",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={clsx("t-body", current ? "font-medium text-text" : done ? "text-muted" : "text-faint")}>{stepLabel(s)}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="t-small text-faint">Todo se guarda en este equipo. No hace falta crear una cuenta.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="h-10 flex-none" />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-12">
          <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center gap-8 pb-12 pt-4">
            <div className="flex items-center gap-3 lg:hidden">
              <LogoMark size={28} />
              <span className="t-small text-faint">
                Paso {index + 1} de {steps.length} · {stepLabel(step)}
              </span>
            </div>
            {body}
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

// Se monta una vez en la raíz: abre solo la primera vez, y cuando se pide con openOnboarding().
export function OnboardingHost() {
  const { needsOnboarding } = useProfiles();
  const [mode, setMode] = useState<OnboardingMode | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (needsOnboarding) setMode("inicio");
  }, [needsOnboarding]);

  useEffect(() => {
    const show = (e: Event) => {
      setMode((e as CustomEvent<OnboardingMode>).detail ?? "agregar");
      setKey((k) => k + 1);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  if (!mode) return null;
  const close = () => setMode(null);

  // La primera vez ocupa toda la ventana (los botones de la ventana quedan arriba, encima).
  if (mode === "inicio") {
    return (
      <div className="fixed inset-0 z-[45] flex bg-bg">
        <Wizard key={key} mode="inicio" onClose={close} />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-lg border border-border bg-bg p-8 shadow-pop">
        <Wizard key={key} mode={mode} onClose={close} />
      </div>
    </div>
  );
}
