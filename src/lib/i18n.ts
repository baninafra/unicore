// Idiomas de la interfaz. Los textos se escriben en español dentro de t("…") y ese mismo texto es la clave:
// cada idioma tiene un archivo src/locales/<idioma>.json que traduce "texto en español" → "traducción".
// Si falta una traducción se muestra el español. Cambiar de idioma recarga la ventana.

import { de as deLocale, enUS, es as esLocale, fr as frLocale, ptBR, zhCN, type Locale } from "date-fns/locale";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import de from "@/locales/de.json";
import pt from "@/locales/pt.json";
import zh from "@/locales/zh.json";

export type Lang = "es" | "en" | "fr" | "de" | "pt" | "zh";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "zh", label: "中文" },
];

const DICTS: Record<Exclude<Lang, "es">, Record<string, string>> = { en, fr, de, pt, zh };
const LOCALES: Record<Lang, Locale> = { es: esLocale, en: enUS, fr: frLocale, de: deLocale, pt: ptBR, zh: zhCN };
// Para Intl (números, fechas con toLocaleString).
const BCP47: Record<Lang, string> = { es: "es-AR", en: "en-US", fr: "fr-FR", de: "de-DE", pt: "pt-BR", zh: "zh-CN" };

const LS_KEY = "uc-lang";

function readLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && LANGS.some((l) => l.value === saved)) return saved as Lang;
    // La primera vez, el idioma del sistema (si es uno de los que hay).
    const sys = (navigator.language || "es").slice(0, 2) as Lang;
    return LANGS.some((l) => l.value === sys) ? sys : "es";
  } catch {
    return "es";
  }
}

let current: Lang = typeof window === "undefined" ? "es" : readLang();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLang = (): Lang => current;
export const dateLocale = (): Locale => LOCALES[current];
export const intlLocale = (): string => BCP47[current];
export const langName = (lang: Lang = current): string => LANGS.find((l) => l.value === lang)?.label ?? "Español";

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {}
  current = lang;
  document.documentElement.lang = lang;
  window.location.reload();
}

// t("Hola, {nombre}", { nombre: "Fran" })
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = current === "es" ? text : (DICTS[current][text] ?? text);
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
