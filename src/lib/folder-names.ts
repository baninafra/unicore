"use client";

// Nombres que el usuario les pone a las carpetas fijas (Diario, Notas, Ideas). Se guardan en este equipo.

import { useEffect, useState } from "react";
import { t } from "./i18n";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER } from "./types";

const LS_KEY = "uc-folder-names";
const EVENT = "uc:folder-names";

export const DEFAULT_FOLDER_NAMES: Record<string, string> = {
  [DAILY_FOLDER]: t("Diario"),
  [LOOSE_FOLDER]: t("Notas"),
  [IDEAS_FOLDER]: t("Ideas"),
};

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function folderName(folder: string): string | undefined {
  return read()[folder]?.trim() || DEFAULT_FOLDER_NAMES[folder];
}

export function renameFolder(folder: string, name: string) {
  const names = read();
  if (name.trim()) names[folder] = name.trim();
  else delete names[folder];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(names));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

// Vuelve a dibujar cuando cambia algún nombre; devuelve un número que cambia en cada cambio.
export function useFolderNames(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = () => setV((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
}
