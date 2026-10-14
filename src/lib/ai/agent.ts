"use client";

// Agente: la IA potente conversa y usa herramientas (tools.ts) hasta terminar el pedido.

import { chatStream, type ApiMessage, type ApiTool, type ApiToolCall } from "./server";
import type { ChatMessage, LocalAI } from "./use-local-ai";
import { runTool, TOOL_DEFS, type ToolContext } from "./tools";

export const AGENT_SYSTEM = `Sos el asistente de UniCore, la app donde el usuario organiza su facultad (carreras, materias, tareas, parciales, apuntes, flashcards). Hablás en español rioplatense (de vos), claro y breve. Usás Markdown liviano.

Tenés herramientas para ACTUAR en la app: crear, editar y eliminar tareas, materias, carreras, notas, ideas y flashcards; cargar cronogramas; buscar en los apuntes; buscar en internet; abrir pantallas. Cuando el usuario te pide hacer algo, hacelo con las herramientas; nunca digas que no podés.

Reglas:
1. Fechas: convertí "el jueves", "mañana", "la semana que viene" con la lista de próximos días que te doy. Nunca supongas otro año: usá el actual. Al confirmar, escribí la fecha como "jue 16/10".
2. Tareas nuevas: necesitás saber qué hay que hacer (título), la materia y la fecha. Si falta alguno de esos datos, o el tipo no es obvio (TP, parcial, entrega…), preguntá TODO lo que falta en un solo mensaje corto antes de crearla. Si el usuario contesta que no sabe, que no tiene más datos o que la cargues así, creala con lo que haya (usá un título genérico como "Tarea de <materia>") sin volver a preguntar. Si ya dio todo, creala directo, sin pedir permiso.
3. Borrar: en el explorador hay notas Y lienzos, así que buscá con listar_elementos (y listar_tareas para tareas). Después hacé UNA sola llamada a eliminar con todo junto (en elementos, o con titulo y carpeta para "todos los que se llaman así"). La app muestra un único botón para confirmar: NO pidas confirmación por texto, no preguntes uno por uno y nunca muestres ids. Si no está claro qué borrar, preguntá antes.
4. Cronogramas y programas: si el usuario adjunta o pega un cronograma, identificá cada clase con su fecha y tema, y cada parcial, recuperatorio, final, TP o entrega; después llamá a cargar_cronograma UNA vez con todo. Si no sabés de qué materia es, preguntá. Si la fecha no trae año, usá el año actual (o el que viene si ya pasó).
5. Internet: para datos actuales, noticias, fechas de eventos o cosas que no sabés con seguridad, usá buscar_web (y leer_pagina si hace falta). Citá la fuente con un link.
6. Para explicar temas, usá primero el MATERIAL de los apuntes si viene en el mensaje; si no alcanza, aclaralo y completá con lo que sabés.
7. Para estudiar: si el usuario pide un cuestionario, examen o que le tomes preguntas (de una clase, nota, materia o tema), usá hacer_cuestionario con 5 a 10 preguntas, indicando la materia y, si corresponde, la clase y para qué parcial es (se guarda ahí y se abre como página). Si pide tarjetas, crear_flashcards. Si pide una tarea para una clase, pasá la clase en crear_tarea.
8. Después de usar herramientas, respondé en una o dos líneas qué hiciste. No muestres ids.`;

export interface AgentEvents {
  onText: (text: string) => void; // texto de la vuelta actual mientras llega
  onTool: (label: string, ok: boolean) => void;
  onToolStart?: (name: string) => void;
}

const MAX_ROUNDS = 10;

type PlainCall = { name: string; args: Record<string, unknown> };

// Si en una vuelta hay varias llamadas a "eliminar", se juntan en una sola (una sola confirmación).
// Devuelve las llamadas a ejecutar y, para cada una original, a cuál quedó unida.
function mergeDeletes(calls: PlainCall[]): { run: PlainCall[]; mapTo: number[] } {
  const delIdx = calls.map((c, i) => (c.name === "eliminar" ? i : -1)).filter((i) => i >= 0);
  if (delIdx.length < 2) return { run: calls, mapTo: calls.map((_, i) => i) };
  const elementos: unknown[] = [];
  const extra: Record<string, unknown> = {};
  for (const i of delIdx) {
    const a = calls[i].args;
    if (Array.isArray(a.elementos)) elementos.push(...a.elementos);
    if (a.id) elementos.push({ tipo: a.tipo, id: a.id });
    if (a.titulo && !extra.titulo) Object.assign(extra, { titulo: a.titulo, carpeta: a.carpeta, tipo: a.tipo });
  }
  const run: PlainCall[] = [];
  const mapTo: number[] = [];
  let merged = -1;
  calls.forEach((c, i) => {
    if (c.name !== "eliminar") {
      mapTo[i] = run.push(c) - 1;
    } else {
      if (merged < 0) merged = run.push({ name: "eliminar", args: { ...extra, elementos } }) - 1;
      mapTo[i] = merged;
    }
  });
  return { run, mapTo };
}

async function execCalls(calls: PlainCall[], ctx: ToolContext, events: AgentEvents): Promise<string[]> {
  const { run, mapTo } = mergeDeletes(calls);
  const results: string[] = [];
  for (const c of run) {
    events.onToolStart?.(c.name);
    try {
      const res = await runTool(c.name, c.args, ctx);
      events.onTool(res.label, res.ok);
      results.push(res.content);
    } catch (err) {
      console.warn("[IA] herramienta falló", c.name, err);
      events.onTool(`Falló ${c.name}`, false);
      results.push(JSON.stringify({ error: err instanceof Error ? err.message : "Error inesperado" }));
    }
  }
  // Las llamadas que se unieron reciben el mismo resultado.
  return calls.map((_, i) => results[mapTo[i]]);
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    // A veces el modelo deja una coma o llave de más.
    try {
      return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return {};
    }
  }
}

// Corre el agente sobre `messages` (que incluye el system y el último mensaje del usuario).
// Agrega a `messages` todo lo que pasa (respuestas y resultados de herramientas) y devuelve el texto final.
export async function runAgent(
  messages: ApiMessage[],
  opts: { ctx: ToolContext; events: AgentEvents; signal: AbortSignal; think?: boolean; tools?: ApiTool[] },
): Promise<string> {
  const tools = opts.tools ?? TOOL_DEFS;
  let finalText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (opts.signal.aborted) break;
    const r = await chatStream(messages, {
      tools,
      think: opts.think,
      signal: opts.signal,
      maxTokens: 6000,
      onDelta: (d) => opts.events.onText(d.content),
    });
    if (!r.toolCalls.length || opts.signal.aborted) {
      messages.push({ role: "assistant", content: r.content });
      finalText = r.content;
      break;
    }
    messages.push({ role: "assistant", content: r.content, tool_calls: r.toolCalls });
    const results = await execCalls(
      r.toolCalls.map((c) => ({ name: c.function.name, args: parseArgs(c.function.arguments) })),
      opts.ctx,
      opts.events,
    );
    r.toolCalls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: results[i] }));
    opts.events.onText("");
  }
  return finalText;
}

// ---------- Agente para la IA básica (Qwen 2.5 en el navegador) ----------
// WebLLM no maneja herramientas, pero Qwen 2.5 fue entrenado con este formato:
//   <tool_call>{"name": "...", "arguments": {...}}</tool_call>
// Le describimos las herramientas en forma compacta (tiene poca memoria) y la app las ejecuta.

// Las que más sirven; las demás quedan para la IA potente.
const LOCAL_TOOLS = [
  "listar_materias",
  "listar_tareas",
  "crear_tarea",
  "editar_tarea",
  "eliminar",
  "listar_elementos",
  "crear_materia",
  "buscar_notas",
  "leer_nota",
  "crear_nota",
  "crear_idea",
  "cargar_cronograma",
  "hacer_cuestionario",
  "crear_flashcards",
  "buscar_web",
  "leer_pagina",
  "abrir",
];

type Schema = { type?: string; description?: string; enum?: unknown[]; items?: Schema; properties?: Record<string, Schema>; required?: string[] };

function describeParam(name: string, s: Schema, required: boolean): string {
  let t = name + (required ? "*" : "");
  if (s.enum) t += ` (${s.enum.filter((e) => e !== "").join("|")})`;
  else if (s.type === "array" && s.items?.properties) {
    const req = new Set(s.items.required ?? []);
    t += ` (lista de {${Object.keys(s.items.properties).map((k) => k + (req.has(k) ? "*" : "")).join(", ")}})`;
  } else if (s.type === "array") t += " (lista)";
  else if (s.description && /YYYY|HH:MM/.test(s.description)) t += ` (${s.description.match(/YYYY-MM-DD|HH:MM/)?.[0]})`;
  return t;
}

export function compactToolList(tools: ApiTool[] = TOOL_DEFS): string {
  return tools
    .filter((t) => LOCAL_TOOLS.includes(t.function.name))
    .map((t) => {
      const p = t.function.parameters as Schema;
      const req = new Set(p.required ?? []);
      const params = Object.entries(p.properties ?? {}).map(([k, v]) => describeParam(k, v, req.has(k)));
      const desc = t.function.description.split(/(?<=\.)\s/)[0];
      return `- ${t.function.name}(${params.join(", ")}): ${desc}`;
    })
    .join("\n");
}

const LOCAL_TOOL_RULES = `
# Herramientas
Para hacer algo en la app, respondé SOLO con una o más llamadas así (JSON válido, sin texto antes):
<tool_call>{"name": "crear_tarea", "arguments": {"titulo": "TP 2", "materia": "Economía", "fecha": "2026-10-16"}}</tool_call>
Después vas a recibir el resultado dentro de <tool_response>…</tool_response> y ahí contestás al usuario en una o dos líneas.
Si no hace falta ninguna herramienta, respondé normal. Nunca digas que hiciste algo (creé, guardé, borré, cargué) sin haber llamado a la herramienta. Los parámetros con * son obligatorios.
Ejemplos:
Usuario: anotá una idea: app de turnos
<tool_call>{"name": "crear_idea", "arguments": {"titulo": "App de turnos"}}</tool_call>
Usuario: borrá todos los sin título de notas
<tool_call>{"name": "listar_elementos", "arguments": {"carpeta": "Notas", "titulo": "Sin título"}}</tool_call>
(con el resultado) <tool_call>{"name": "eliminar", "arguments": {"elementos": [{"tipo": "lienzo", "id": "…"}, {"tipo": "nota", "id": "…"}]}}</tool_call>
Herramientas disponibles:
`;

// "Eliminé", "Guardé", "Creé", "Cargué", "Agregué", "Borré", "Anoté", "Listo, …"
const CLAIMS_ACTION = /(^|[^a-záéíóúñ])(elimin[eé]|borr[eé]|guard[eé]|cre[eé]|cargu[eé]|agregu[eé]|anot[eé]|agend[eé]|arm[eé])(?![a-záéíóúñ])/i;

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g;

// Valor de Python/JS suelto: "texto", 'texto', números, True/False/None, listas y objetos.
function looseValue(v: string): unknown {
  const t = v.trim();
  if (/^(true|True)$/.test(t)) return true;
  if (/^(false|False)$/.test(t)) return false;
  if (/^(null|None)$/.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^["'][\s\S]*["']$/.test(t)) return t.slice(1, -1);
  try {
    return JSON.parse(t.replace(/'/g, '"').replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null"));
  } catch {
    return t;
  }
}

// Separa "a=1, b='x, y', c=[1,2]" respetando comillas y corchetes.
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if ("[{(".includes(ch)) depth++;
    else if ("]})".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function callFromObject(obj: Record<string, unknown>) {
  const name = typeof obj.name === "string" ? obj.name : "";
  const rawArgs = obj.arguments ?? obj.parameters ?? {};
  const args = (typeof rawArgs === "string" ? parseArgs(rawArgs) : (rawArgs as Record<string, unknown>)) ?? {};
  return name ? { name, args } : null;
}

// Qwen 2.5 a veces se olvida de las etiquetas o escribe la llamada como función de Python.
// Aceptamos: <tool_call>{...}</tool_call>, un JSON suelto con "name" y "arguments", o nombre(a="x", b=1).
export function parseLocalCalls(text: string, known: string[] = LOCAL_TOOLS): { name: string; args: Record<string, unknown> }[] {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const m of text.matchAll(TOOL_CALL_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    const c = callFromObject(parseArgs(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
    if (c) calls.push(c);
  }
  if (calls.length) return calls.filter((c) => known.includes(c.name));

  // JSON suelto: buscamos objetos con "name" de una herramienta conocida.
  for (const m of text.matchAll(/\{\s*"name"\s*:\s*"([a-z_]+)"/g)) {
    if (!known.includes(m[1])) continue;
    const start = m.index!;
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        const c = callFromObject(parseArgs(text.slice(start, i + 1)));
        if (c) calls.push(c);
        break;
      }
    }
  }
  if (calls.length) return calls;

  // Estilo función: crear_idea(titulo="App", lista=False)
  for (const m of text.matchAll(/_?([a-z_]+)\(([\s\S]*?)\)\s*$/gm)) {
    const name = m[1].replace(/^_/, "");
    if (!known.includes(name)) continue;
    const args: Record<string, unknown> = {};
    for (const part of splitArgs(m[2])) {
      const eq = part.indexOf("=");
      if (eq > 0) args[part.slice(0, eq).trim()] = looseValue(part.slice(eq + 1));
    }
    calls.push({ name, args });
  }
  return calls;
}

// Texto que ve el usuario mientras llega: sin las llamadas a herramientas.
const visibleText = (t: string) => {
  const s = t.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").trim();
  // Mientras escribe una llamada sin etiquetas, no mostramos el JSON.
  return /^\s*\{\s*"name"/.test(s) || /^_?[a-z_]+\(/.test(s) ? "" : s;
};

// Pasa la conversación (formato del servidor) a mensajes simples para WebLLM.
export function toLocalMessages(messages: ApiMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") out.push({ role: "system", content: `${m.content}\n${LOCAL_TOOL_RULES}${compactToolList()}` });
    else if (m.role === "user")
      out.push({ role: "user", content: typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "[imagen]")).join("\n") });
    else if (m.role === "assistant") {
      const calls = (m.tool_calls ?? []).map((c) => `<tool_call>{"name": "${c.function.name}", "arguments": ${c.function.arguments || "{}"}}</tool_call>`);
      out.push({ role: "assistant", content: [m.content, ...calls].filter(Boolean).join("\n") });
    } else if (m.role === "tool") {
      // Varias respuestas seguidas van en un mismo mensaje del usuario, como en la plantilla de Qwen.
      const last = out[out.length - 1];
      const piece = `<tool_response>\n${m.content}\n</tool_response>`;
      if (last?.role === "user" && last.content.startsWith("<tool_response>")) last.content += `\n${piece}`;
      else out.push({ role: "user", content: piece });
    }
  }
  return out;
}

export async function runAgentLocal(
  messages: ApiMessage[],
  opts: { ctx: ToolContext; events: AgentEvents; signal: AbortSignal; ai: Pick<LocalAI, "generate"> },
): Promise<string> {
  let finalText = "";
  for (let round = 0; round < 6; round++) {
    if (opts.signal.aborted) break;
    const raw = await opts.ai.generate(toLocalMessages(messages), {
      temperature: 0.3,
      maxTokens: 1500,
      onToken: (full) => opts.events.onText(visibleText(full)),
    });
    let calls = opts.signal.aborted ? [] : parseLocalCalls(raw);
    // Dijo que hizo algo pero no llamó a ninguna herramienta: le pedimos que lo haga de verdad (una vez).
    if (!calls.length && !opts.signal.aborted && round === 0 && CLAIMS_ACTION.test(raw)) {
      const retry = await opts.ai.generate(
        [
          ...toLocalMessages(messages),
          { role: "assistant", content: raw },
          { role: "user", content: "Todavía no hiciste nada en la app. Respondé SOLO con la llamada <tool_call>{...}</tool_call> que corresponde." },
        ],
        { temperature: 0.2, maxTokens: 1500 },
      );
      calls = parseLocalCalls(retry);
    }
    if (!calls.length) {
      finalText = visibleText(raw);
      messages.push({ role: "assistant", content: finalText });
      break;
    }
    const toolCalls: ApiToolCall[] = calls.map((c, i) => ({
      id: `local_${round}_${i}`,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    messages.push({ role: "assistant", content: visibleText(raw), tool_calls: toolCalls });
    const results = await execCalls(calls, opts.ctx, opts.events);
    toolCalls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
    opts.events.onText("");
  }
  return finalText;
}
