"use client";

// Herramientas de la IA que usan las herramientas de la barra derecha: cuentas exactas (mathjs)
// y traducción sin conexión (modelos chicos por idioma).

import type { ApiTool } from "./server";
import type { ToolResult } from "./tools";

type Args = Record<string, unknown>;

const S = (description: string) => ({ type: "string", description });
const json = (v: unknown) => JSON.stringify(v);
const fail = (msg: string): ToolResult => ({ ok: false, content: json({ error: msg }), label: msg });

export const UTIL_TOOL_DEFS: ApiTool[] = [
  {
    type: "function",
    function: {
      name: "calcular",
      description:
        "Hace una cuenta exacta con una calculadora científica: aritmética, potencias, raíces, trigonometría (en grados: sin(30 deg)), logaritmos, matrices, derivadas (derivative('x^2','x')), unidades ('5 km to mi') y estadística (mean, std). Usala siempre en vez de calcular de cabeza.",
      parameters: { type: "object", properties: { expresion: S("Expresión en sintaxis de mathjs, con punto decimal") }, required: ["expresion"] },
    },
  },
  {
    type: "function",
    function: {
      name: "traducir",
      description: "Traduce un texto sin conexión con el traductor de la app. Idiomas por código: es, en, pt, fr, de, it, ru, zh, ja, ar, hi, nl, uk y otros.",
      parameters: {
        type: "object",
        properties: { texto: S("Texto a traducir"), de: S("Código del idioma de origen, ej: en"), a: S("Código del idioma de destino, ej: es") },
        required: ["texto", "a"],
      },
    },
  },
];

// Devuelve null si la herramienta no es de estas.
export async function runUtilTool(name: string, a: Args): Promise<ToolResult | null> {
  if (name === "calcular") {
    const expr = typeof a.expresion === "string" ? a.expresion : "";
    if (!expr.trim()) return fail("Falta la expresión.");
    try {
      const { evaluate, format } = await import("mathjs");
      const r = evaluate(expr);
      const text = format(r, { precision: 14 });
      return { ok: true, content: json({ resultado: text }), label: `Calculé ${expr} = ${text}` };
    } catch (err) {
      return fail(err instanceof Error ? `No pude calcular: ${err.message}` : "No pude calcular.");
    }
  }
  if (name === "traducir") {
    const texto = typeof a.texto === "string" ? a.texto : "";
    const to = typeof a.a === "string" ? a.a.toLowerCase().slice(0, 2) : "es";
    const from = typeof a.de === "string" && a.de ? a.de.toLowerCase().slice(0, 2) : to === "es" ? "en" : "es";
    if (!texto.trim()) return fail("Falta el texto.");
    try {
      const { translate } = await import("../tools/translate");
      const out = await translate(texto, from, to);
      return { ok: true, content: json({ traduccion: out }), label: "Traduje el texto" };
    } catch (err) {
      return fail(err instanceof Error ? `No pude traducir: ${err.message}` : "No pude traducir.");
    }
  }
  return null;
}
