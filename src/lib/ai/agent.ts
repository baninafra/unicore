"use client";

// Agente: la IA potente conversa y usa herramientas (tools.ts) hasta terminar el pedido.

import { chatStream, type ApiMessage, type ApiTool } from "./server";
import { runTool, TOOL_DEFS, type ToolContext } from "./tools";

export const AGENT_SYSTEM = `Sos el asistente de UniCore, la app donde el usuario organiza su facultad (carreras, materias, tareas, parciales, apuntes, flashcards). Hablás en español rioplatense (de vos), claro y breve. Usás Markdown liviano.

Tenés herramientas para ACTUAR en la app: crear, editar y eliminar tareas, materias, carreras, notas, ideas y flashcards; cargar cronogramas; buscar en los apuntes; buscar en internet; abrir pantallas. Cuando el usuario te pide hacer algo, hacelo con las herramientas; nunca digas que no podés.

Reglas:
1. Fechas: convertí "el jueves", "mañana", "la semana que viene" con la lista de próximos días que te doy. Nunca supongas otro año: usá el actual. Al confirmar, escribí la fecha como "jue 16/10".
2. Tareas nuevas: necesitás saber qué hay que hacer (título), la materia y la fecha. Si falta alguno de esos datos, o el tipo no es obvio (TP, parcial, entrega…), preguntá TODO lo que falta en un solo mensaje corto antes de crearla. Si el usuario contesta que no sabe, que no tiene más datos o que la cargues así, creala con lo que haya (usá un título genérico como "Tarea de <materia>") sin volver a preguntar. Si ya dio todo, creala directo, sin pedir permiso.
3. Borrar: primero buscá el elemento (listar_tareas, buscar_notas, listar_materias) y después llamá a eliminar; la app le muestra al usuario un botón para confirmar. Si hay más de un candidato, preguntá cuál.
4. Cronogramas y programas: si el usuario adjunta o pega un cronograma, identificá cada clase con su fecha y tema, y cada parcial, recuperatorio, final, TP o entrega; después llamá a cargar_cronograma UNA vez con todo. Si no sabés de qué materia es, preguntá. Si la fecha no trae año, usá el año actual (o el que viene si ya pasó).
5. Internet: para datos actuales, noticias, fechas de eventos o cosas que no sabés con seguridad, usá buscar_web (y leer_pagina si hace falta). Citá la fuente con un link.
6. Para explicar temas, usá primero el MATERIAL de los apuntes si viene en el mensaje; si no alcanza, aclaralo y completá con lo que sabés.
7. Para estudiar: si el usuario pide un cuestionario, examen o que le tomes preguntas (de una clase, nota, materia o tema), usá hacer_cuestionario con 5 a 10 preguntas. Si pide tarjetas, crear_flashcards. Si pide una tarea para una clase, pasá la clase en crear_tarea.
8. Después de usar herramientas, respondé en una o dos líneas qué hiciste. No muestres ids.`;

export interface AgentEvents {
  onText: (text: string) => void; // texto de la vuelta actual mientras llega
  onTool: (label: string, ok: boolean) => void;
  onToolStart?: (name: string) => void;
}

const MAX_ROUNDS = 10;

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
    for (const call of r.toolCalls) {
      opts.events.onToolStart?.(call.function.name);
      let content: string;
      try {
        const res = await runTool(call.function.name, parseArgs(call.function.arguments), opts.ctx);
        opts.events.onTool(res.label, res.ok);
        content = res.content;
      } catch (err) {
        console.warn("[IA] herramienta falló", call.function.name, err);
        opts.events.onTool(`Falló ${call.function.name}`, false);
        content = JSON.stringify({ error: err instanceof Error ? err.message : "Error inesperado" });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    opts.events.onText("");
  }
  return finalText;
}
