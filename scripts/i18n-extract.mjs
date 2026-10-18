// Junta todos los textos marcados con t("…") en src/ y deja la lista en src/locales/claves.json.
// También avisa qué claves faltan traducir en cada idioma. Uso: node scripts/i18n-extract.mjs

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const LANGS = ["en", "fr", "de", "pt", "zh"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.push(p);
  }
  return out;
}

// t("…") o t('…'), con escapes. Sólo literales (no variables).
const RE = /\bt\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/g;
const keys = new Set();
for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(RE)) {
    const raw = m[1] ?? m[2];
    keys.add(JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"')}"`));
  }
}
const list = [...keys].sort((a, b) => a.localeCompare(b, "es"));
writeFileSync(join(SRC, "locales", "claves.json"), JSON.stringify(list, null, 2) + "\n");
console.log(`${list.length} textos`);
for (const lang of LANGS) {
  const dict = JSON.parse(readFileSync(join(SRC, "locales", `${lang}.json`), "utf8"));
  const missing = list.filter((k) => !(k in dict));
  console.log(`${lang}: faltan ${missing.length}`);
}
