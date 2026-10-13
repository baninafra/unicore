// Normalización para buscar: sin acentos y, salvo que se distingan mayúsculas, en minúsculas.
// Cada carácter se reemplaza por uno solo (los espacios por " "), así los índices de un texto
// plegado coinciden con los del original y podemos resaltar sobre el texto real.

function foldChar(c: string, caseSensitive: boolean): string {
  if (/\s/.test(c)) return " ";
  let f = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!caseSensitive) f = f.toLowerCase();
  return f.length === c.length ? f : c;
}

export function foldText(text: string, caseSensitive = false): string {
  return Array.from(text, (c) => foldChar(c, caseSensitive)).join("");
}

// Puntaje de coincidencia difusa: las letras de la consulta tienen que aparecer en orden.
// Ambos textos ya vienen plegados. Devuelve -1 si no coincide.
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const sub = text.indexOf(query);
  if (sub >= 0) return 1000 - sub;
  let score = 0;
  let pos = 0;
  let prev = -2;
  for (const ch of query) {
    const idx = text.indexOf(ch, pos);
    if (idx < 0) return -1;
    score += idx === prev + 1 ? 3 : 1;
    if (idx === 0 || /[\s\-_:/.]/.test(text[idx - 1])) score += 2;
    score -= (idx - pos) * 0.1;
    prev = idx;
    pos = idx + 1;
  }
  return score;
}
