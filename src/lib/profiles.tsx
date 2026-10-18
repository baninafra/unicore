"use client";

// Perfiles: UniCore no es sólo para la facultad. Cada "espacio" (la tabla degrees) tiene un tipo
// —universidad, colegio, trabajo, proyectos o personal— y la app cambia los nombres, los tipos de tarea
// y las secciones según el perfil activo. Lo que el usuario contó al arrancar (nombre, perfiles, sobre vos)
// se guarda en este equipo y también lo usa la IA.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, GraduationCap, Heart, Layers2, Rocket, School, type LucideIcon } from "lucide-react";
import { db, newId } from "./db";
import type { Degree, ProfileKind, SubjectStatus, Task, TaskType } from "./types";

export type { ProfileKind };
export const PROFILE_KINDS: ProfileKind[] = ["universidad", "colegio", "trabajo", "proyectos", "personal"];

// Un sustantivo con su plural y su género (para "Nueva carrera" / "Nuevo proyecto").
export interface Noun {
  one: string; // en minúscula: "carrera"
  many: string; // "carreras"
  f: boolean; // femenino
}

export interface ProfileDef {
  kind: ProfileKind | "general";
  label: string; // "Universidad"
  icon: LucideIcon;
  blurb: string; // una línea para el asistente de bienvenida
  space: Noun; // el contenedor grande (carrera, empresa…)
  spaceIcon: LucideIcon;
  item: Noun; // lo que va adentro (materia, proyecto…)
  unit: string; // "Unidad", "Etapa"
  spacesView: string; // nombre de la pantalla que lista los espacios: "Mis carreras"
  study: boolean; // años, cuatrimestres, correlativas, notas y repaso con flashcards
  // Los perfiles que no son de estudio son un solo espacio (el perfil mismo): adentro van directo los proyectos o áreas.
  taskTypes: Record<TaskType, string>;
  statuses: Record<SubjectStatus, string>;
}

const STUDY_TASKS: Record<TaskType, string> = { PARCIAL: "Parcial", FINAL: "Final", TP: "TP", FORO: "Foro", LECTURA: "Lectura", TAREA: "Tarea" };
const STUDY_STATUS: Record<SubjectStatus, string> = { PENDIENTE: "Pendiente", CURSANDO: "Cursando", REGULAR: "Regular", APROBADA: "Aprobada" };
const PROJECT_STATUS: Record<SubjectStatus, string> = { PENDIENTE: "Por empezar", CURSANDO: "En curso", REGULAR: "En pausa", APROBADA: "Terminado" };

export const PROFILES: Record<ProfileKind, ProfileDef> = {
  universidad: {
    kind: "universidad",
    label: "Universidad",
    icon: GraduationCap,
    blurb: "Carreras, materias, parciales, apuntes y repaso",
    space: { one: "carrera", many: "carreras", f: true },
    spaceIcon: GraduationCap,
    item: { one: "materia", many: "materias", f: true },
    unit: "Unidad",
    spacesView: "Mis carreras",
    study: true,
    taskTypes: STUDY_TASKS,
    statuses: STUDY_STATUS,
  },
  colegio: {
    kind: "colegio",
    label: "Colegio",
    icon: School,
    blurb: "Secundario o terciario: materias, pruebas y trabajos",
    space: { one: "curso", many: "cursos", f: false },
    spaceIcon: School,
    item: { one: "materia", many: "materias", f: true },
    unit: "Unidad",
    spacesView: "Mis cursos",
    study: true,
    taskTypes: { PARCIAL: "Prueba", FINAL: "Examen", TP: "Trabajo práctico", FORO: "Exposición", LECTURA: "Lectura", TAREA: "Tarea" },
    statuses: { PENDIENTE: "Por cursar", CURSANDO: "Cursando", REGULAR: "Previa", APROBADA: "Aprobada" },
  },
  trabajo: {
    kind: "trabajo",
    label: "Trabajo",
    icon: Briefcase,
    blurb: "Tu empleo: proyectos, reuniones, entregas e informes",
    space: { one: "trabajo", many: "trabajos", f: false },
    spaceIcon: Briefcase,
    item: { one: "proyecto", many: "proyectos", f: false },
    unit: "Etapa",
    spacesView: "Proyectos",
    study: false,
    taskTypes: { PARCIAL: "Presentación", FINAL: "Entrega final", TP: "Entregable", FORO: "Reunión", LECTURA: "Lectura", TAREA: "Tarea" },
    statuses: PROJECT_STATUS,
  },
  proyectos: {
    kind: "proyectos",
    label: "Proyectos",
    icon: Rocket,
    blurb: "Freelance, emprendimientos o proyectos propios",
    space: { one: "espacio", many: "espacios", f: false },
    spaceIcon: Rocket,
    item: { one: "proyecto", many: "proyectos", f: false },
    unit: "Etapa",
    spacesView: "Proyectos",
    study: false,
    taskTypes: { PARCIAL: "Hito", FINAL: "Lanzamiento", TP: "Entregable", FORO: "Reunión", LECTURA: "Investigación", TAREA: "Tarea" },
    statuses: PROJECT_STATUS,
  },
  personal: {
    kind: "personal",
    label: "Personal",
    icon: Heart,
    blurb: "Salud, finanzas, hogar, hobbies y metas",
    space: { one: "espacio", many: "espacios", f: false },
    spaceIcon: Heart,
    item: { one: "área", many: "áreas", f: true },
    unit: "Parte",
    spacesView: "Áreas",
    study: false,
    taskTypes: { PARCIAL: "Evento", FINAL: "Meta", TP: "Trámite", FORO: "Turno", LECTURA: "Lectura", TAREA: "Pendiente" },
    statuses: { PENDIENTE: "Más adelante", CURSANDO: "Activa", REGULAR: "En pausa", APROBADA: "Cumplida" },
  },
};

// Cuando se ven varios perfiles juntos.
export const GENERAL: ProfileDef = {
  kind: "general",
  label: "Todo",
  icon: Layers2,
  blurb: "Todos tus perfiles juntos",
  space: { one: "espacio", many: "espacios", f: false },
  spaceIcon: Layers2,
  item: { one: "tema", many: "temas", f: false },
  unit: "Unidad",
  spacesView: "Mis espacios",
  study: true,
  taskTypes: STUDY_TASKS,
  statuses: STUDY_STATUS,
};

export const cap = (s: string) => s.charAt(0).toLocaleUpperCase("es-AR") + s.slice(1);
// "Nueva carrera", "Nuevo proyecto"
export const nuevo = (n: Noun) => `${n.f ? "Nueva" : "Nuevo"} ${n.one}`;

// Los espacios viejos (sin tipo) son carreras.
export const kindOf = (degree?: Pick<Degree, "kind">): ProfileKind => degree?.kind ?? "universidad";

// ---------- Perfiles del usuario ----------

// Un perfil es del usuario: tiene nombre propio ("Facultad", "Laburo en Acme", "Freelance") y un tipo
// que define los nombres y las secciones. Puede haber varios del mismo tipo.
export interface Profile {
  id: string;
  name: string;
  kind: ProfileKind;
}

export interface UserProfile {
  name: string; // nombre de la persona
  profiles: Profile[];
  active: string; // id del perfil que se está viendo, o "todos"
  about: string; // texto libre: a qué se dedica, qué quiere lograr (contexto para la IA)
  onboarded: boolean;
}

const LS_KEY = "uc-profile";
const EVENT = "uc-profile-change";
const EMPTY: UserProfile = { name: "", profiles: [], active: "todos", about: "", onboarded: false };

const isKind = (k: unknown): k is ProfileKind => PROFILE_KINDS.includes(k as ProfileKind);

export function readProfile(): UserProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Partial<UserProfile> & { kinds?: unknown[] };
    let profiles: Profile[] = Array.isArray(saved.profiles)
      ? saved.profiles.filter((p): p is Profile => !!p && typeof p.id === "string" && typeof p.name === "string" && isKind(p.kind))
      : [];
    // Formato anterior: una lista de tipos. Cada tipo pasa a ser un perfil (con el tipo como id).
    if (!Array.isArray(saved.profiles) && Array.isArray(saved.kinds)) {
      profiles = saved.kinds.filter(isKind).map((k) => ({ id: k, name: PROFILES[k].label, kind: k }));
    }
    const active = saved.active && profiles.some((p) => p.id === saved.active) ? saved.active : "todos";
    return {
      name: typeof saved.name === "string" ? saved.name : "",
      profiles,
      active,
      about: typeof saved.about === "string" ? saved.about : "",
      onboarded: saved.onboarded === true,
    };
  } catch {
    return EMPTY;
  }
}

export function writeProfile(patch: Partial<UserProfile>) {
  const next = { ...readProfile(), ...patch };
  if (next.active !== "todos" && !next.profiles.some((p) => p.id === next.active)) next.active = "todos";
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

// A qué perfil pertenece un espacio: el que tiene guardado o, si no tiene, el primero de su tipo.
// Si su perfil se borró, no es de ninguno (se ve sólo en «Todos los perfiles»).
export function profileOfDegree(profiles: Profile[], degree: Pick<Degree, "profileId" | "kind">): Profile | undefined {
  if (degree.profileId) return profiles.find((p) => p.id === degree.profileId);
  return profiles.find((p) => p.kind === kindOf(degree));
}

export const newProfile = (kind: ProfileKind, name?: string): Profile => ({ id: newId(), name: name?.trim() || PROFILES[kind].label, kind });

// Texto para la IA: quién es el usuario y para qué usa la app.
export function profileText(): string {
  const p = readProfile();
  const lines: string[] = [];
  if (p.name) lines.push(`El usuario se llama ${p.name}.`);
  if (p.profiles.length) lines.push(`Sus perfiles en UniCore: ${p.profiles.map((x) => `${x.name} (${PROFILES[x.kind].label})`).join(", ")}.`);
  if (p.about.trim()) lines.push(`Lo que contó de sí mismo: ${p.about.trim()}`);
  return lines.join(" ");
}

// ---------- Contexto ----------

interface ProfileState {
  profile: UserProfile;
  profiles: Profile[];
  activeProfile?: Profile; // undefined = todos
  update: (patch: Partial<UserProfile>) => void;
  setActive: (id: string) => void;
  ready: boolean; // ya se leyó el perfil y la base
  needsOnboarding: boolean;
  activeKinds: ProfileKind[]; // tipos de perfil que se ven ahora
  terms: ProfileDef; // nombres para lo que se ve ahora
  termsFor: (degreeId?: string) => ProfileDef; // nombres de un espacio puntual
  termsForSubject: (subjectId?: string) => ProfileDef;
  profileFor: (degreeId?: string) => Profile | undefined;
  singleSpace?: Degree; // el espacio único del perfil activo (trabajo, proyectos, personal)
  inScope: (degreeId?: string) => boolean; // el espacio entra en el perfil activo
  taskInScope: (task: Pick<Task, "degreeId" | "subjectId">) => boolean;
  taskLabel: (task: Pick<Task, "type" | "degreeId" | "subjectId">) => string;
}

const Ctx = createContext<ProfileState | null>(null);

// Espacios únicos que se están creando (para no duplicarlos si el efecto corre dos veces).
const creating = new Set<string>();

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const degrees = useLiveQuery(() => db.degrees.toArray(), []);
  const subjects = useLiveQuery(async () => (await db.subjects.toArray()).map((s) => ({ id: s.id, degreeId: s.degreeId })), []);

  useEffect(() => {
    const read = () => setProfile(readProfile());
    read();
    setLoaded(true);
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);

  // Quien ya tenía datos de antes no pasa por las preguntas: se arma un perfil por cada tipo que hay.
  // Sólo se mira al abrir la app (no mientras el asistente está creando cosas).
  const legacyChecked = useRef(false);
  useEffect(() => {
    if (!loaded || !degrees || legacyChecked.current) return;
    legacyChecked.current = true;
    if (profile.onboarded || degrees.length === 0) return;
    const kinds = PROFILE_KINDS.filter((k) => degrees.some((d) => kindOf(d) === k));
    writeProfile({ profiles: kinds.map((k) => ({ id: k, name: PROFILES[k].label, kind: k })), active: "todos", onboarded: true });
  }, [loaded, degrees, profile.onboarded]);

  const { profiles } = profile;

  // Trabajo, proyectos y personal: cada perfil tiene su único espacio, con el mismo nombre que el perfil.
  useEffect(() => {
    if (!loaded || !degrees) return;
    for (const p of profiles) {
      if (PROFILES[p.kind].study) continue;
      const own = degrees.filter((d) => profileOfDegree(profiles, d)?.id === p.id);
      if (own.length === 0) {
        if (creating.has(p.id)) continue;
        creating.add(p.id);
        // Se vuelve a mirar la base: el asistente puede haberlo creado recién (la consulta en vivo llega después).
        void (async () => {
          const fresh = await db.degrees.toArray();
          if (!fresh.some((d) => profileOfDegree(profiles, d)?.id === p.id)) {
            await db.degrees.add({ id: newId(), name: p.name, shortName: p.name.slice(0, 4).toUpperCase().padEnd(2, "X"), color: "primary", totalYears: 1, kind: p.kind, profileId: p.id, createdAt: new Date().toISOString() });
          }
          creating.delete(p.id);
        })();
      } else if (own.length === 1 && (own[0].name !== p.name || own[0].profileId !== p.id || own[0].kind !== p.kind)) {
        void db.degrees.update(own[0].id, { name: p.name, profileId: p.id, kind: p.kind });
      }
    }
  }, [loaded, degrees, profiles]);

  const activeProfile = profiles.find((p) => p.id === profile.active);
  const degreeById = useMemo(() => new Map((degrees ?? []).map((d) => [d.id, d])), [degrees]);
  const degreeOfSubject = useMemo(() => new Map((subjects ?? []).map((s) => [s.id, s.degreeId])), [subjects]);

  const activeKinds = useMemo(() => {
    if (activeProfile) return [activeProfile.kind];
    const used = new Set<ProfileKind>([...profiles.map((p) => p.kind), ...[...degreeById.values()].map(kindOf)]);
    const list = PROFILE_KINDS.filter((k) => used.has(k));
    return list.length ? list : (["universidad"] as ProfileKind[]);
  }, [activeProfile, profiles, degreeById]);

  const terms = activeKinds.length === 1 ? PROFILES[activeKinds[0]] : GENERAL;

  const termsFor = useCallback(
    (degreeId?: string) => {
      const d = degreeId ? degreeById.get(degreeId) : undefined;
      return d ? PROFILES[kindOf(d)] : terms;
    },
    [degreeById, terms],
  );
  const termsForSubject = useCallback((subjectId?: string) => termsFor(subjectId ? degreeOfSubject.get(subjectId) : undefined), [termsFor, degreeOfSubject]);
  const profileFor = useCallback(
    (degreeId?: string) => {
      const d = degreeId ? degreeById.get(degreeId) : undefined;
      return d ? profileOfDegree(profiles, d) : undefined;
    },
    [degreeById, profiles],
  );

  const inScope = useCallback(
    (degreeId?: string) => {
      if (!activeProfile || !degreeId) return true;
      const d = degreeById.get(degreeId);
      return !d || profileOfDegree(profiles, d)?.id === activeProfile.id;
    },
    [activeProfile, profiles, degreeById],
  );
  const taskInScope = useCallback(
    (t: Pick<Task, "degreeId" | "subjectId">) => inScope(t.degreeId ?? (t.subjectId ? degreeOfSubject.get(t.subjectId) : undefined)),
    [inScope, degreeOfSubject],
  );
  const taskLabel = useCallback(
    (t: Pick<Task, "type" | "degreeId" | "subjectId">) => (t.degreeId ? termsFor(t.degreeId) : termsForSubject(t.subjectId)).taskTypes[t.type],
    [termsFor, termsForSubject],
  );

  const singleSpace = useMemo(
    () => (activeProfile && !PROFILES[activeProfile.kind].study ? [...degreeById.values()].find((d) => profileOfDegree(profiles, d)?.id === activeProfile.id) : undefined),
    [activeProfile, degreeById, profiles],
  );

  const value: ProfileState = {
    profile,
    profiles,
    activeProfile,
    update: writeProfile,
    setActive: (active) => writeProfile({ active }),
    ready: loaded && degrees !== undefined,
    needsOnboarding: loaded && degrees !== undefined && degrees.length === 0 && !profile.onboarded,
    activeKinds,
    terms,
    termsFor,
    termsForSubject,
    profileFor,
    singleSpace,
    inScope,
    taskInScope,
    taskLabel,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfiles() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfiles tiene que usarse dentro de <ProfileProvider>");
  return ctx;
}

// Igual que useProfiles, pero sin romper fuera del proveedor (devuelve null).
export function useProfilesMaybe() {
  return useContext(Ctx);
}
