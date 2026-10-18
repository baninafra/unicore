"use client";

// Borrar sin preguntar: se borra al toque y aparece un aviso con "Deshacer".
// Mientras corre `deleteWithUndo`, todo lo que se borra de la base (también en cascada)
// queda guardado en memoria para poder restaurarlo.

import { db } from "./db";
import { t } from "@/lib/i18n";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastDetail {
  id: number;
  text: string;
  action?: ToastAction;
  tone?: "error";
  ms?: number;
}

let toastSeq = 0;

export function toast(text: string, opts: { action?: ToastAction; tone?: "error"; ms?: number } = {}) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("uc:toast", { detail: { id: ++toastSeq, text, ...opts } }));
}

type Captured = { table: string; obj: unknown }[];
let recording: Captured | null = null;
let hooked = false;

function installHooks() {
  if (hooked) return;
  hooked = true;
  for (const table of db.tables) {
    table.hook("deleting", (_pk, obj) => {
      if (recording && obj) recording.push({ table: table.name, obj: structuredCloneSafe(obj) });
    });
  }
}

function structuredCloneSafe<T>(obj: T): T {
  try {
    return structuredClone(obj);
  } catch {
    return obj;
  }
}

async function restore(captured: Captured) {
  const byTable = new Map<string, unknown[]>();
  for (const c of captured) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c.obj]);
  const tables = [...byTable.keys()].map((name) => db.table(name));
  await db.transaction("rw", tables, async () => {
    for (const [name, rows] of byTable) await db.table(name).bulkPut(rows);
  });
}

// Borrados que se pueden deshacer con Ctrl+Z (el último primero).
const undoStack: { label: string; captured: Captured }[] = [];

// Deshace el último borrado. Devuelve false si no hay nada para restaurar.
export async function undoLastDelete(): Promise<boolean> {
  const last = undoStack.pop();
  if (!last) return false;
  try {
    await restore(last.captured);
    const deleted = t("Se eliminó");
    toast(last.label.startsWith(deleted) ? t("Se restauró") + last.label.slice(deleted.length) : t("Se restauró lo eliminado."));
  } catch {
    toast(t("No pudimos deshacer."), { tone: "error" });
  }
  return true;
}

// Borra y ofrece deshacer. `label`: "Se eliminó la tarea «TP 2»".
export async function deleteWithUndo(label: string, run: () => unknown): Promise<void> {
  installHooks();
  const prev = recording;
  const mine: Captured = [];
  recording = mine;
  try {
    await run();
    // Algunos borrados se disparan sin esperar (runSafe): les damos un momento para terminar.
    await new Promise((r) => setTimeout(r, 700));
  } catch (err) {
    toast(t("No pudimos eliminar. Probá de nuevo."), { tone: "error" });
    throw err;
  } finally {
    recording = prev;
    if (prev) prev.push(...mine);
  }
  if (!mine.length || prev) return;
  const entry = { label, captured: mine };
  undoStack.push(entry);
  if (undoStack.length > 20) undoStack.shift();
  toast(label, {
    ms: 8000,
    action: {
      label: t("Deshacer"),
      run: () => {
        const i = undoStack.indexOf(entry);
        if (i >= 0) undoStack.splice(i, 1); // ya restaurado: Ctrl+Z no lo repite
        return restore(mine).catch(() => toast(t("No pudimos deshacer."), { tone: "error" }));
      },
    },
  });
}
