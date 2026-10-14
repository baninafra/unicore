"use client";

// Cliente de la IA potente: llama-server (llama.cpp) corriendo en esta PC, con API tipo OpenAI.
// La app de escritorio lo arranca sola (ver src-tauri/src/ia.rs). En el navegador se puede
// levantar a mano en el mismo puerto.

import { isDesktop } from "../desktop";

export const SERVER_PORT = 8642;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;

export interface ServerInfo {
  installed: boolean;
  running: boolean;
  port: number;
  model?: string;
  vision: boolean;
}

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ApiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; tool_calls?: ApiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ApiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function serverInfo(): Promise<ServerInfo | null> {
  if (isDesktop()) {
    try {
      return await invoke<ServerInfo>("ia_info");
    } catch {
      return null;
    }
  }
  // En el navegador sólo sabemos si alguien lo dejó corriendo.
  const ok = await healthy();
  return ok ? { installed: true, running: true, port: SERVER_PORT, vision: false } : null;
}

export async function serverLog(): Promise<string> {
  return isDesktop() ? invoke<string>("ia_log").catch(() => "") : "";
}

let starting: Promise<void> | null = null;

// Arranca el servidor (si hace falta) y espera a que el modelo termine de cargar.
export function ensureServer(onProgress?: (text: string) => void): Promise<void> {
  if (!starting) {
    starting = (async () => {
      if (await healthy()) return;
      if (isDesktop()) await invoke("ia_start", { ctx: 32768 });
      onProgress?.("Cargando el modelo en la placa de video…");
      const t0 = Date.now();
      // La primera carga de 13 GB desde el disco puede tardar un par de minutos.
      while (Date.now() - t0 < 5 * 60_000) {
        try {
          const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
          if (r.ok) return;
          if (r.status !== 503) throw new Error(`estado ${r.status}`);
        } catch {
          // todavía no abrió el puerto
        }
        if (isDesktop()) {
          const info = await invoke<ServerInfo>("ia_info").catch(() => null);
          if (info && !info.running) throw new Error("El servidor de IA se cerró al cargar el modelo. Revisá que haya memoria libre.");
        }
        const secs = Math.round((Date.now() - t0) / 1000);
        onProgress?.(`Cargando el modelo en la placa de video… ${secs} s`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("El modelo tardó demasiado en cargar.");
    })().finally(() => {
      starting = null;
    });
  }
  return starting;
}

export async function stopServer() {
  if (isDesktop()) await invoke("ia_stop").catch(() => undefined);
}

export interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: ApiToolCall[];
  finish?: string;
}

export interface ChatOptions {
  tools?: ApiTool[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  think?: boolean;
  signal?: AbortSignal;
  onDelta?: (r: StreamResult) => void;
}

// Una vuelta de chat con streaming. Junta texto, razonamiento y llamadas a herramientas.
export async function chatStream(messages: ApiMessage[], opts: ChatOptions = {}): Promise<StreamResult> {
  const think = opts.think ?? false;
  const body: Record<string, unknown> = {
    messages,
    stream: true,
    // Valores recomendados por Qwen para 3.5 (con y sin razonamiento).
    temperature: opts.temperature ?? (think ? 0.6 : 0.7),
    top_p: think ? 0.95 : 0.8,
    top_k: 20,
    min_p: 0,
    presence_penalty: think || opts.json ? 0 : 1.5,
    max_tokens: opts.maxTokens ?? 4096,
    chat_template_kwargs: { enable_thinking: think },
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.parallel_tool_calls = true;
  }
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`La IA respondió con un error (${res.status}). ${text.slice(0, 200)}`);
  }

  const out: StreamResult = { content: "", reasoning: "", toolCalls: [] };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            finish_reason?: string | null;
          }[];
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta ?? {};
        if (d.content) out.content += d.content;
        if (d.reasoning_content) out.reasoning += d.reasoning_content;
        for (const tc of d.tool_calls ?? []) {
          const slot = (out.toolCalls[tc.index] ??= {
            id: tc.id ?? `call_${tc.index}_${Date.now()}`,
            type: "function",
            function: { name: "", arguments: "" },
          });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.function.name += tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
        if (choice.finish_reason) out.finish = choice.finish_reason;
        opts.onDelta?.(out);
      }
    }
  } catch (err) {
    // Al detener a mano, devolvemos lo que llegó.
    if (!(err instanceof DOMException && err.name === "AbortError")) throw err;
  }
  out.toolCalls = out.toolCalls.filter(Boolean);
  return out;
}
