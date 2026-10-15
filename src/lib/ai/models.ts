"use client";

// Modelos Qwen 3.5 de la IA local: qué tamaños hay, hasta cuál aguanta esta PC y cuál usar
// en cada modo (Low, Default, Ultra o Automático según la tarea).

import { isDesktop } from "../desktop";

export interface QwenModel {
  id: string;
  label: string; // "Qwen3.5 9B"
  bytes: number; // en el disco (modelo + visión)
  model_bytes: number;
  rank: number; // cuanto más alto, más capaz
  moe: boolean;
  installed: boolean;
}

export interface Hardware {
  ram: number;
  vram: number;
  gpu: string;
}

export interface Catalog {
  hardware: Hardware;
  engine_installed: boolean;
  models: QwenModel[];
}

export type Tier = "low" | "default" | "ultra";

export async function fetchCatalog(): Promise<Catalog | null> {
  if (!isDesktop()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Catalog>("ia_catalog");
  } catch {
    return null;
  }
}

const GB = 1e9;

// ¿Anda bien en esta PC? Los densos tienen que entrar en la placa (más ~1,5 GB de memoria de
// la conversación); los MoE pueden dejar parte en la RAM. Sin placa, sólo los chicos.
export function fits(m: QwenModel, hw: Hardware): boolean {
  const vram = hw.vram >= 2 * GB ? hw.vram : 0;
  if (m.moe) {
    if (vram >= 6 * GB) return vram + hw.ram - 8 * GB >= m.model_bytes + 2 * GB;
    return hw.ram >= 32 * GB;
  }
  if (vram) return m.model_bytes + 1.5 * GB <= vram;
  return m.model_bytes <= 3 * GB && m.model_bytes <= hw.ram * 0.35;
}

// El más capaz que aguanta la PC.
export function maxModel(c: Catalog): QwenModel | undefined {
  return c.models.filter((m) => fits(m, c.hardware)).sort((a, b) => b.rank - a.rank)[0] ?? c.models[0];
}

// Lo que conviene bajar para tener los tres modos: uno chico, uno mediano y el más grande que entra.
export function suggestedSet(c: Catalog): QwenModel[] {
  const max = maxModel(c);
  if (!max) return [];
  const byId = (id: string) => c.models.find((m) => m.id === id);
  const below = (ids: string[]) => ids.map(byId).filter((m): m is QwenModel => !!m && m.rank < max.rank);
  const [low, mid] = max.rank >= 5 ? below(["2b", "9b"]) : max.rank === 4 ? below(["2b", "4b"]) : below(["0.8b", "2b"]);
  return [low, mid, max].filter((m, i, a): m is QwenModel => !!m && a.indexOf(m) === i);
}

// Qué modelo descargado corresponde a cada modo: Low el más chico, Ultra el más grande y Default el del medio.
export function tierModels(c: Catalog | null): Partial<Record<Tier, QwenModel>> {
  const got = (c?.models ?? []).filter((m) => m.installed).sort((a, b) => a.rank - b.rank);
  if (!got.length) return {};
  return {
    low: got[0],
    default: got[Math.ceil((got.length - 1) / 2)],
    ultra: got[got.length - 1],
  };
}

// Lo que sabemos de un pedido para que el modo Automático elija el tamaño.
export interface TaskHint {
  text?: string; // lo que escribió el usuario
  chars?: number; // largo total de lo que va al modelo (con adjuntos y material)
  images?: boolean;
  think?: boolean;
  json?: boolean;
}

const HARD =
  /resum|explic|analiz|compar|demostr|resolv|ejercicio|problema|parcial|final|cronograma|plan de estudio|cuestionario|flashcard|apunte|bibliograf|desarroll|redact|ensayo|monograf|c[oó]digo|program|calcul|integral|derivad|traduc|por qu[eé]/i;
const ACTION = /cre[aá]|agreg|anot|borr|elimin|cambi|mov[eé]|tarea|nota|materia|record|agend|busc|internet|web|video|link|http/i;

export function pickTier(t?: TaskHint): Tier {
  if (!t) return "default"; // precarga sin pedido todavía
  const text = t.text ?? "";
  const chars = t.chars ?? text.length;
  if (t.images || t.think || chars > 12000 || HARD.test(text)) return "ultra";
  if (t.json || chars > 400 || ACTION.test(text)) return "default";
  return "low";
}
