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
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiFont: 13,
  editorFont: 16,
  readableWidth: true,
  spellcheck: true,
  wordCount: true,
};

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
    return {
      uiFont: clamp(saved.uiFont, 12, 16, DEFAULT_SETTINGS.uiFont),
      editorFont: clamp(saved.editorFont, 14, 20, DEFAULT_SETTINGS.editorFont),
      readableWidth: typeof saved.readableWidth === "boolean" ? saved.readableWidth : DEFAULT_SETTINGS.readableWidth,
      spellcheck: typeof saved.spellcheck === "boolean" ? saved.spellcheck : DEFAULT_SETTINGS.spellcheck,
      wordCount: typeof saved.wordCount === "boolean" ? saved.wordCount : DEFAULT_SETTINGS.wordCount,
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
  ".bn-editor { font-size: var(--editor-font-size, 16px) !important; }",
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
