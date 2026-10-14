"use client";

import { useCallback, useEffect, useState } from "react";

// Preferencias de la interfaz y del editor. Se guardan en localStorage y se aplican
// con variables CSS en <html>. Montar <ApplySettings /> una vez en la raíz de la app.

export interface AppSettings {
  uiFont: number; // px base de la interfaz, 12 a 16 (13 = normal)
  editorFont: number; // px del editor, 14 a 20
  readableWidth: boolean; // limita el ancho de las vistas de lectura
  spellcheck: boolean; // corrector ortográfico
  wordCount: boolean; // conteo de palabras en el editor
  editorFamily: "sans" | "serif" | "mono"; // tipografía del editor
  editorSpacing: "compacto" | "normal" | "amplio"; // altura de línea del editor
  weekStart: "lun" | "dom"; // primer día de la semana en el calendario
  showDoneTasks: boolean; // tareas hechas visibles en el calendario
  calendarSyncMinutes: number; // cada cuánto se sincronizan los calendarios externos (0 = a mano)
  notifOverdue: boolean; // avisos: entregas vencidas
  notifToday: boolean; // avisos: lo de hoy
  notifTomorrow: boolean; // avisos: lo de mañana
  notifUpcoming: boolean; // avisos: próximos días
  notifReview: boolean; // avisos: flashcards para repasar
  notifEvents: boolean; // avisos: eventos de calendarios externos de hoy y mañana
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiFont: 13,
  editorFont: 16,
  readableWidth: true,
  spellcheck: true,
  wordCount: true,
  editorFamily: "sans",
  editorSpacing: "normal",
  weekStart: "lun",
  showDoneTasks: true,
  calendarSyncMinutes: 30,
  notifOverdue: true,
  notifToday: true,
  notifTomorrow: true,
  notifUpcoming: true,
  notifReview: true,
  notifEvents: true,
};

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

const FAMILY: Record<AppSettings["editorFamily"], string> = {
  sans: "inherit",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Code', Consolas, monospace",
};
const SPACING: Record<AppSettings["editorSpacing"], string> = { compacto: "1.4", normal: "1.6", amplio: "1.85" };

const LS_KEY = "uc-settings";
const EVENT = "uc-settings-change";
const STYLE_ID = "uc-settings-style";

function clamp(n: unknown, min: number, max: number, fallback: number) {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    const d = DEFAULT_SETTINGS;
    return {
      uiFont: clamp(saved.uiFont, 12, 16, d.uiFont),
      editorFont: clamp(saved.editorFont, 14, 20, d.editorFont),
      readableWidth: bool(saved.readableWidth, d.readableWidth),
      spellcheck: bool(saved.spellcheck, d.spellcheck),
      wordCount: bool(saved.wordCount, d.wordCount),
      editorFamily: pick(saved.editorFamily, ["sans", "serif", "mono"], d.editorFamily),
      editorSpacing: pick(saved.editorSpacing, ["compacto", "normal", "amplio"], d.editorSpacing),
      weekStart: pick(saved.weekStart, ["lun", "dom"], d.weekStart),
      showDoneTasks: bool(saved.showDoneTasks, d.showDoneTasks),
      calendarSyncMinutes: [0, 15, 30, 60, 360].includes(saved.calendarSyncMinutes as number) ? (saved.calendarSyncMinutes as number) : d.calendarSyncMinutes,
      notifOverdue: bool(saved.notifOverdue, d.notifOverdue),
      notifToday: bool(saved.notifToday, d.notifToday),
      notifTomorrow: bool(saved.notifTomorrow, d.notifTomorrow),
      notifUpcoming: bool(saved.notifUpcoming, d.notifUpcoming),
      notifReview: bool(saved.notifReview, d.notifReview),
      notifEvents: bool(saved.notifEvents, d.notifEvents),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Tamaños de texto de la interfaz (base 13 px). Cada clase escala con --ui-scale.
const SIZE_RULES: [string, number][] = [
  [".t-label, .section-label, .kbd", 11],
  [".t-small, .row, .btn, .input, .prop-row, .nav-item, .wikilink", 13],
  [".t-body, .t-h3", 15],
  [".t-h2", 19],
  [".t-h1", 24],
  [".btn-sm, .badge, .tag", 12],
];

const STYLE = [
  ...SIZE_RULES.map(([sel, px]) => `${sel} { font-size: calc(${px}px * var(--ui-scale, 1)); }`),
  "body { font-size: calc(14px * var(--ui-scale, 1)); }",
  ".view-readable { max-width: var(--readable-width, 760px); }",
  ".bn-editor { font-size: var(--editor-font-size, 16px) !important; font-family: var(--editor-font-family, inherit) !important; line-height: var(--editor-line-height, 1.6); }",
].join("\n");

function ensureStyle() {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = STYLE;
}

// Aplica las preferencias en el documento (idempotente).
export function applySettings(s: AppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--ui-scale", String(s.uiFont / 13));
  root.style.setProperty("--editor-font-size", `${s.editorFont}px`);
  root.style.setProperty("--readable-width", s.readableWidth ? "760px" : "none");
  root.style.setProperty("--editor-font-family", FAMILY[s.editorFamily]);
  root.style.setProperty("--editor-line-height", SPACING[s.editorSpacing]);
  document.body.spellcheck = s.spellcheck;
  ensureStyle();
}

export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readSettings(), ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {}
  applySettings(next);
  window.dispatchEvent(new CustomEvent<AppSettings>(EVENT, { detail: next }));
  return next;
}

// Monta esto una sola vez en la raíz (app-shell) para aplicar las preferencias al iniciar.
export function ApplySettings() {
  useEffect(() => {
    applySettings(readSettings());
  }, []);
  return null;
}

// Lee y cambia las preferencias desde cualquier componente.
export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
    const onChange = (e: Event) => setSettings((e as CustomEvent<AppSettings>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    writeSettings(patch);
  }, []);

  return [settings, update];
}
