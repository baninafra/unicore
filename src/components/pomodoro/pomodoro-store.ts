"use client";

import { useSyncExternalStore } from "react";
import { db, newId, nowIso } from "@/lib/db";

// Estado del reloj Pomodoro. Vive fuera de React para que siga corriendo al navegar.
// Mientras corre guarda la hora de fin (endsAt), así al recargar se recalcula el tiempo.

export type PomodoroMode = "25/5" | "50/10";
export type PomodoroPhase = "focus" | "break";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface PomodoroState {
  mode: PomodoroMode;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  remainingMs: number; // lo que falta cuando está quieto o en pausa
  endsAt: number | null; // hora de fin (epoch ms) mientras corre
  completedFocus: number; // focos terminados en el ciclo actual
  longBreak: boolean; // el descanso en curso es el largo
  subjectId: string | null;
}

const KEY = "uc-pomodoro";
const MIN = 60_000;
export const POMODORO_CYCLE = 4;

export const POMODORO_MODES: Record<PomodoroMode, { focus: number; short: number; long: number }> = {
  "25/5": { focus: 25, short: 5, long: 15 },
  "50/10": { focus: 50, short: 10, long: 20 },
};

export function phaseTotalMs(s: Pick<PomodoroState, "mode" | "phase" | "longBreak">): number {
  const m = POMODORO_MODES[s.mode];
  if (s.phase === "focus") return m.focus * MIN;
  return (s.longBreak ? m.long : m.short) * MIN;
}

function initialState(): PomodoroState {
  const base = {
    mode: "25/5" as PomodoroMode,
    phase: "focus" as PomodoroPhase,
    status: "idle" as PomodoroStatus,
    endsAt: null,
    completedFocus: 0,
    longBreak: false,
    subjectId: null,
  };
  return { ...base, remainingMs: phaseTotalMs(base) };
}

const SERVER_STATE = initialState();

function load(): PomodoroState {
  const fallback = initialState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<PomodoroState>;
    const s: PomodoroState = {
      mode: p.mode && p.mode in POMODORO_MODES ? p.mode : fallback.mode,
      phase: p.phase === "break" ? "break" : "focus",
      status: p.status === "running" || p.status === "paused" ? p.status : "idle",
      remainingMs: typeof p.remainingMs === "number" ? p.remainingMs : 0,
      endsAt: typeof p.endsAt === "number" ? p.endsAt : null,
      completedFocus: typeof p.completedFocus === "number" ? p.completedFocus : 0,
      longBreak: p.longBreak === true,
      subjectId: typeof p.subjectId === "string" ? p.subjectId : null,
    };
    if (s.status === "running" && s.endsAt === null) s.status = "idle";
    if (s.status !== "running" && s.remainingMs <= 0) s.remainingMs = phaseTotalMs(s);
    return s;
  } catch {
    return fallback;
  }
}

function persist(s: PomodoroState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Sin localStorage (modo privado, etc.) el reloj funciona igual, pero no se recuerda.
  }
}

let state: PomodoroState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
let audioCtx: AudioContext | null = null;
const listeners = new Set<() => void>();

function getState(): PomodoroState {
  if (!state) state = load();
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Hook de lectura. En el servidor (y en la primera pintura) usa el estado inicial.
export function usePomodoro(): PomodoroState {
  return useSyncExternalStore(subscribe, getState, () => SERVER_STATE);
}

// Tiempo que falta, según la hora actual.
export function remainingAt(s: PomodoroState, now: number): number {
  return s.status === "running" && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

function elapsedMinutes(s: PomodoroState, now: number): number {
  return Math.round((phaseTotalMs(s) - remainingAt(s, now)) / MIN);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// "45 min", "1 h", "1 h 15 min"
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function recordSession(subjectId: string | null, minutes: number, completedAt: string) {
  if (minutes < 1) return;
  db.studySessions
    .add({ id: newId(), subjectId: subjectId ?? undefined, durationMinutes: minutes, completedAt })
    .catch(console.error);
}

// Aviso suave. Sólo suena si el usuario ya interactuó con la página (regla del navegador).
function playBeep() {
  try {
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Sin audio no pasa nada: el cambio de fase igual se ve en el chip.
  }
}

function startBreak(s: PomodoroState, at: number): PomodoroState {
  const completedFocus = s.completedFocus + 1;
  const next = { ...s, phase: "break" as const, completedFocus, longBreak: completedFocus % POMODORO_CYCLE === 0 };
  const ms = phaseTotalMs(next);
  return { ...next, status: "running", remainingMs: ms, endsAt: at + ms };
}

function startFocus(s: PomodoroState): PomodoroState {
  const next = { ...s, phase: "focus" as const, longBreak: false, status: "idle" as const, endsAt: null };
  return { ...next, remainingMs: phaseTotalMs(next) };
}

function commit(next: PomodoroState) {
  state = next;
  persist(next);
  listeners.forEach((l) => l());
  schedule();
}

function schedule() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  const s = getState();
  if (s.status !== "running" || s.endsAt === null) return;
  const delay = Math.min(Math.max(0, s.endsAt - Date.now()), 2_000_000_000);
  timer = setTimeout(() => {
    timer = undefined;
    sync();
  }, delay);
}

// Pone al día el estado con la hora actual: cierra las fases vencidas (también las de hace horas).
function sync() {
  let s = getState();
  let changed = false;
  let guard = 0;
  while (s.status === "running" && s.endsAt !== null && s.endsAt <= Date.now() && guard < 8) {
    guard++;
    const endedAt = s.endsAt;
    if (s.phase === "focus") {
      recordSession(s.subjectId, POMODORO_MODES[s.mode].focus, new Date(endedAt).toISOString());
      s = startBreak(s, endedAt);
    } else {
      s = startFocus(s);
    }
    playBeep();
    changed = true;
  }
  if (changed) commit(s);
  else schedule();
}

// Arranca el reloj una sola vez en el navegador (llamar desde un efecto).
export function initPomodoro() {
  if (started) return;
  started = true;
  sync();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) sync();
  });
  window.addEventListener("focus", sync);
}

export function start() {
  const s = getState();
  if (s.status === "running") return;
  const remaining = s.remainingMs > 0 ? s.remainingMs : phaseTotalMs(s);
  commit({ ...s, status: "running", remainingMs: remaining, endsAt: Date.now() + remaining });
}

export function pause() {
  const s = getState();
  if (s.status !== "running") return;
  commit({ ...s, status: "paused", remainingMs: remainingAt(s, Date.now()), endsAt: null });
}

// Sólo se cambia el modo con el reloj quieto.
export function setMode(mode: PomodoroMode) {
  const s = getState();
  if (s.status !== "idle" || s.mode === mode) return;
  const next = { ...s, mode };
  commit({ ...next, remainingMs: phaseTotalMs(next) });
}

export function setSubject(subjectId: string | null) {
  commit({ ...getState(), subjectId });
}

// Terminar: corta el ciclo y vuelve a quieto. Si estaba en foco, guarda lo estudiado.
export function finish() {
  const s = getState();
  if (s.phase === "focus") recordSession(s.subjectId, elapsedMinutes(s, Date.now()), nowIso());
  const next: PomodoroState = { ...s, phase: "focus", status: "idle", completedFocus: 0, longBreak: false, endsAt: null, remainingMs: 0 };
  commit({ ...next, remainingMs: phaseTotalMs(next) });
}

// Saltar: pasa al bloque siguiente. Si era foco, guarda lo estudiado y arranca el descanso.
export function skip() {
  const s = getState();
  const now = Date.now();
  if (s.phase === "focus") {
    recordSession(s.subjectId, elapsedMinutes(s, now), nowIso());
    commit(startBreak(s, now));
  } else {
    commit(startFocus(s));
  }
}
