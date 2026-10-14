"use client";

// Chat de IA del panel derecho. Usa la materia o la nota de la vista activa como contexto.
// Con la IA potente (en esta PC) además actúa: crea tareas, carga cronogramas, busca en internet, etc.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, Brain, Check, FileText, Globe, Image as ImageIcon, Paperclip, Send, Square, SquarePen, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db, newId } from "@/lib/db";
import { useLocalAI, type ChatMessage } from "@/lib/ai/use-local-ai";
import { buildSubjectContext } from "@/lib/ai/rag";
import { useWorkspace, type ViewState } from "@/lib/workspace";
import { noteTitle, specialFolderName } from "@/lib/panes/note-data";
import { useActiveNoteId, useNote } from "@/lib/panes/hooks";
import { LOCAL_MODELS, useAISettings, writeAISettings, type LocalModel } from "@/lib/ai/ai-settings";
import { AGENT_SYSTEM, runAgent, runAgentLocal } from "@/lib/ai/agent";
import { situationText } from "@/lib/ai/tools";
import type { ApiMessage, ContentPart } from "@/lib/ai/server";
import { convertFile, fileKind, IMPORT_ACCEPT } from "@/lib/import/import-file";
import { Markdown } from "./markdown";
import { Select } from "@/components/ui/select";

// Selector del modelo (todos corren en esta PC).
function ModelPicker() {
  const s = useAISettings();
  return (
    <Select
      aria-label="Modelo de IA"
      className="h-7 min-w-0 max-w-[170px] cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-muted outline-none hover:border-border hover:bg-surface-raised focus:border-primary"
      value={s.localModel}
      onChange={(e) => writeAISettings({ localModel: e.target.value as LocalModel })}
    >
      {LOCAL_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </Select>
  );
}

interface Attachment {
  id: string;
  name: string;
  kind: "image" | "doc";
  status: "reading" | "ready" | "error";
  text?: string;
  dataUrl?: string;
  error?: string;
}

interface Step {
  label: string;
  ok: boolean;
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  steps?: Step[];
  working?: string; // "Buscando en internet…"
  sources?: string[];
  failed?: boolean;
}

interface PendingConfirm {
  turnId: string;
  title: string;
  detail: string;
  resolve: (yes: boolean) => void;
}

const HISTORY_TURNS = 6;
const HISTORY_CHARS_USER = 800;
const HISTORY_CHARS_ASSISTANT = 600;
const NOTE_CHARS = 1500; // texto de la nota abierta que entra en el contexto
const DOC_CHARS = 24000; // texto de un archivo adjunto que entra en el mensaje
const AGENT_KEEP = 40; // mensajes de la conversación que se le mandan a la IA potente

const TOOL_WORKING: Record<string, string> = {
  buscar_web: "Buscando en internet…",
  leer_pagina: "Leyendo la página…",
  cargar_cronograma: "Cargando el cronograma…",
  buscar_notas: "Buscando en tus apuntes…",
  listar_tareas: "Revisando tu agenda…",
};

function buildSystemPrompt(contextName: string | undefined, material: string): string {
  const base =
    "Sos un tutor universitario. Explicás con claridad, en español rioplatense (usá vos), en pasos cortos y con ejemplos cuando ayudan. " +
    "Usá Markdown liviano: listas, negritas y tablas cuando comparás cosas. No inventes datos ni citas. " +
    `Hoy es ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
  if (!contextName) {
    return `${base}\nNo hay un tema seleccionado, así que respondé con conocimiento general y aclarí cuando sea una suposición.`;
  }
  if (!material) {
    return `${base}\nEl tema es "${contextName}", pero no encontramos apuntes relacionados con la pregunta. Respondé con conocimiento general y aclaralo al principio.`;
  }
  return (
    `${base}\nEl tema es "${contextName}". Usá primero el MATERIAL que sigue. ` +
    "Si la respuesta no está ahí, decilo y completá con conocimiento general, aclarándolo.\n\n" +
    `MATERIAL:\n${material}`
  );
}

// Pasa la respuesta a párrafos sueltos para insertarla en el editor (sin marcas de Markdown).
function answerToParagraphs(md: string) {
  return md
    .split("\n")
    .filter((line) => !/^\s*\|?(\s*:?-{3,}:?\s*\|?)+\s*$/.test(line)) // filas separadoras de tablas
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "• ")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .map((text) => ({ type: "paragraph" as const, content: text }));
}

// Achica la foto (lado mayor 1280 px) para que la IA la procese rápido.
async function imageToDataUrl(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Las imágenes viejas de la conversación se reemplazan por texto para no gastar contexto.
function compactHistory(msgs: ApiMessage[], keep = AGENT_KEEP): ApiMessage[] {
  const [system, ...rest] = msgs;
  const tail = rest.slice(-keep);
  while (tail.length && tail[0].role === "tool") tail.shift();
  const lastUser = tail.map((m) => m.role).lastIndexOf("user");
  return [
    system,
    ...tail.map((m, i) =>
      m.role === "user" && Array.isArray(m.content) && i !== lastUser
        ? { role: "user" as const, content: m.content.map((p) => (p.type === "text" ? p.text : "[imagen]")).join("\n") }
        : m,
    ),
  ];
}

export function AIChatPane() {
  const { currentSubjectId } = useAppState();
  const { activeView, openView } = useWorkspace();
  const ai = useLocalAI();
  const settings = useAISettings();
  // Las dos IAs actúan en la app; la potente además ve imágenes y razona.
  const powerful = ai.engine === "servidor";
  const agentMode = true;

  // Contexto: la materia de la vista activa, o la de la nota abierta.
  const noteId = useActiveNoteId();
  const note = useNote(noteId);
  const subjectId = activeView.type === "materia" ? activeView.id : note ? note.subjectId : currentSubjectId;
  const subject = useLiveQuery(() => (subjectId ? db.subjects.get(subjectId) : undefined), [subjectId]);
  const subjectName = subjectId ? (specialFolderName(subjectId) ?? subject?.name) : undefined;
  const chipName = note ? noteTitle(note) : subjectName;
  const contextName = subjectName ?? (note ? noteTitle(note) : undefined);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const apiRef = useRef<ApiMessage[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const unavailable = ai.status === "unsupported" && !agentMode;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // El campo crece con el texto hasta 160 px.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Mantiene a la vista el final de la conversación mientras llega el streaming.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, confirm]);

  // Otros módulos pueden mandar texto o archivos al chat ("Preguntar a la IA" del clic derecho).
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; send?: boolean; files?: File[] }>).detail ?? {};
      if (d.files?.length) addFiles(d.files);
      if (d.text) {
        if (d.send) void send(d.text);
        else {
          setInput((v) => (v ? `${v}\n${d.text}` : d.text!));
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("uc:ai-ask", onAsk);
    return () => window.removeEventListener("uc:ai-ask", onAsk);
  });

  const patchTurn = (id: string, patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));

  function addFiles(files: File[]) {
    for (const file of files) {
      const kind = fileKind(file);
      const att: Attachment = { id: newId(), name: file.name || "imagen", kind: kind === "image" ? "image" : "doc", status: "reading" };
      setAttachments((prev) => [...prev, att]);
      const done = (patch: Partial<Attachment>) => setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, ...patch } : a)));
      (async () => {
        if (kind === "image") {
          const dataUrl = await imageToDataUrl(file);
          done({ status: "ready", dataUrl });
          return;
        }
        const c = await convertFile(file);
        done({ status: "ready", text: c.text.slice(0, DOC_CHARS) });
      })().catch((err) => done({ status: "error", error: err instanceof Error ? err.message : "No pudimos leer el archivo." }));
    }
  }

  function askConfirm(turnId: string, title: string, detail: string): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirm({ turnId, title, detail, resolve });
    });
  }

  function answerConfirm(yes: boolean) {
    confirm?.resolve(yes);
    setConfirm(null);
  }

  async function sendAgent(text: string, atts: Attachment[], aiId: string) {
    if (!apiRef.current) {
      apiRef.current = [{ role: "system", content: `${AGENT_SYSTEM}\n\n${await situationText()}` }];
    }

    // Material de los apuntes (si hay una materia o nota en pantalla).
    let material = "";
    let sources: string[] = [];
    // La IA básica tiene poca memoria: menos material.
    const docChars = powerful ? DOC_CHARS : 5000;
    const noteChars = powerful ? NOTE_CHARS : 700;
    if (subjectId && text.length > 3) {
      try {
        const found = await buildSubjectContext(subjectId, text, powerful ? 3 : 1);
        material = found.context;
        sources = found.sources.map((s) => s.label);
      } catch {
        // seguimos sin material
      }
    }
    const noteBody = note?.plainTextCache.trim().slice(0, noteChars) ?? "";
    if (note && noteBody) {
      material = [`[Fuente: ${noteTitle(note)} (nota abierta)]\n${noteBody}`, material].filter(Boolean).join("\n\n");
      sources = [noteTitle(note), ...sources];
    }

    const parts: string[] = [];
    if (contextName) parts.push(`[El usuario está viendo: ${note ? `la nota «${noteTitle(note)}»` : ""}${note && subjectName ? " de " : ""}${subjectName ?? ""}]`);
    for (const a of atts.filter((a) => a.kind === "doc" && a.text)) parts.push(`[Archivo adjunto: ${a.name}]\n"""\n${a.text!.slice(0, docChars)}\n"""`);
    if (material) parts.push(`MATERIAL de los apuntes (usalo si sirve para la pregunta):\n${material}`);
    parts.push(text || "(mirá el adjunto)");
    const textPart = parts.join("\n\n");
    const images = powerful ? atts.filter((a) => a.kind === "image" && a.dataUrl) : [];
    const content: string | ContentPart[] = images.length
      ? [...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.dataUrl! } })), { type: "text" as const, text: textPart }]
      : textPart;

    apiRef.current.push({ role: "user", content });
    const messages = compactHistory(apiRef.current, powerful ? AGENT_KEEP : 10);
    const sent = messages.length;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    await ai.load();
    ai.setBusy(true);
    try {
      const common = {
        signal: ctrl.signal,
        ctx: { confirm: (title: string, detail: string) => askConfirm(aiId, title, detail), openView: (v: ViewState) => openView(v, "tab"), userText: text },
        events: {
          onText: (t: string) => patchTurn(aiId, { content: t, working: undefined }),
          onToolStart: (name: string) => patchTurn(aiId, { working: TOOL_WORKING[name] ?? "Trabajando…" }),
          onTool: (label: string, ok: boolean) => patchTurn(aiId, (t) => ({ steps: [...(t.steps ?? []), { label, ok }], working: undefined })),
        },
      };
      const final = powerful
        ? await runAgent(messages, { ...common, think: settings.think })
        : await runAgentLocal(messages, { ...common, ai });
      // Lo nuevo (respuestas y resultados) queda en la conversación.
      apiRef.current.push(...messages.slice(sent));
      patchTurn(aiId, (t) => ({
        content: final.trim() || (t.steps?.length ? "" : "No llegué a responder. Probá de nuevo."),
        working: undefined,
        sources: sources.length ? [...new Set(sources)] : undefined,
      }));
    } finally {
      ai.setBusy(false);
      abortRef.current = null;
    }
  }

  async function sendSimple(text: string, aiId: string) {
    const history: ChatMessage[] = turns
      .filter((t) => !t.failed && t.content.trim())
      .slice(-HISTORY_TURNS)
      .map((t) => ({
        role: t.role,
        content: t.content.slice(0, t.role === "assistant" ? HISTORY_CHARS_ASSISTANT : HISTORY_CHARS_USER),
      }));
    // La pregunta anterior también sirve para buscar contexto ("y eso cómo se calcula?").
    const previousQuestion = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";

    let context = "";
    let sources: string[] = [];
    if (subjectId) {
      try {
        const found = await buildSubjectContext(subjectId, `${previousQuestion} ${text}`, note ? 3 : 4);
        context = found.context;
        sources = found.sources.map((s) => s.label);
      } catch {
        // Sin contexto igual respondemos, y la IA lo aclara.
      }
    }

    const noteBody = note?.plainTextCache.trim().slice(0, NOTE_CHARS) ?? "";
    let material = context;
    if (note && noteBody) {
      material = [`[Fuente: ${noteTitle(note)} (nota abierta)]\n${noteBody}`, context].filter(Boolean).join("\n\n");
      sources = [noteTitle(note), ...sources];
    }

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(contextName, material) },
      ...history,
      { role: "user", content: text },
    ];
    const answer = await ai.generate(messages, {
      temperature: 0.6,
      maxTokens: 800,
      onToken: (full) => patchTurn(aiId, { content: full }),
    });
    patchTurn(aiId, {
      content: answer.trim() ? answer : "No llegué a responder. Probá de nuevo.",
      sources: sources.length > 0 ? [...new Set(sources)] : undefined,
    });
  }

  async function send(raw: string) {
    const text = raw.trim();
    const atts = attachments.filter((a) => a.status === "ready");
    if ((!text && !atts.length) || busy || unavailable) return;
    if (attachments.some((a) => a.status === "reading")) return;

    const aiId = newId();
    setTurns((prev) => [
      ...prev,
      { id: newId(), role: "user", content: text, attachments: atts.length ? atts : undefined },
      { id: aiId, role: "assistant", content: "" },
    ]);
    setInput("");
    setAttachments([]);
    setBusy(true);

    try {
      if (agentMode) await sendAgent(text, atts, aiId);
      else {
        const docs = atts.filter((a) => a.kind === "doc" && a.text).map((a) => `[Archivo: ${a.name}]\n${a.text!.slice(0, 4000)}`);
        await sendSimple([...docs, text].filter(Boolean).join("\n\n"), aiId);
      }
    } catch (err) {
      patchTurn(aiId, {
        content: err instanceof Error ? err.message : "No pudimos responder. Probá de nuevo.",
        failed: true,
        working: undefined,
      });
    } finally {
      setBusy(false);
      setConfirm((c) => {
        c?.resolve(false);
        return null;
      });
    }
  }

  function stopAll() {
    abortRef.current?.abort();
    ai.stop();
    confirm?.resolve(false);
    setConfirm(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) addFiles(files);
  }

  function newConversation() {
    if (busy) stopAll();
    setTurns([]);
    apiRef.current = null;
  }

  function activate() {
    ai.load().catch(() => undefined);
  }

  function insertAnswer(content: string) {
    window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail: { blocks: answerToParagraphs(content) } }));
  }

  function renderStatus() {
    switch (ai.status) {
      case "unsupported":
        return <p className="t-small text-muted">Tu navegador no puede correr la IA. Probá con Chrome o Edge actualizados.</p>;
      case "loading": {
        const pct = Math.round(ai.progress * 100);
        return (
          <div className="min-w-0 flex-1 space-y-1">
            {!agentMode && (
              <div className="progress h-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="truncate text-[12px] text-faint">{ai.progressText || "Preparando la IA…"}</p>
          </div>
        );
      }
      case "error":
        return (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] text-rose" title={ai.error}>
              {ai.error ?? "No pudimos preparar la IA. Probá de nuevo."}
            </p>
            <button type="button" onClick={activate} className="flex-none text-[13px] text-primary-soft underline underline-offset-2">
              Reintentar
            </button>
          </div>
        );
      case "idle":
        return (
          <span className="flex items-center gap-3">
            <button type="button" onClick={activate} className="text-[13px] text-primary-soft underline underline-offset-2">
              Activar IA
            </button>
            <button
              type="button"
              onClick={() => openView({ type: "ajustes", section: "ia" }, "tab")}
              className="text-[13px] text-faint underline underline-offset-2 hover:text-text"
            >
              Descargar o elegir IA
            </button>
          </span>
        );
      case "generating":
        return <span className="text-[13px] text-faint">Trabajando…</span>;
      default:
        return <span className="text-[13px] text-faint">Lista</span>;
    }
  }

  const canSend = (input.trim() || attachments.some((a) => a.status === "ready")) && !attachments.some((a) => a.status === "reading");

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary-tint/80 text-[13px] text-text">
          Soltá para adjuntar
        </div>
      )}

      <div className="flex min-h-9 flex-none items-center gap-1 px-3 py-1.5">
        <ModelPicker />
        {agentMode && (
          <>
            {powerful && <button
              type="button"
              className={clsx("icon-btn flex-none", settings.think && "text-primary-soft")}
              onClick={() => writeAISettings({ think: !settings.think })}
              aria-pressed={settings.think}
              title={settings.think ? "Razona antes de responder (más lento)" : "Responde directo (más rápido)"}
            >
              <Brain strokeWidth={1.75} />
            </button>}
            <span title="Puede buscar en internet" className="flex-none text-faint">
              <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end">{renderStatus()}</div>
        <button
          type="button"
          className="icon-btn flex-none disabled:opacity-40"
          onClick={newConversation}
          disabled={turns.length === 0}
          aria-label="Nueva conversación"
          title="Nueva conversación"
        >
          <SquarePen strokeWidth={1.75} />
        </button>
      </div>

      {chipName && (
        <div className="flex-none px-3 pb-1">
          <span className="tag max-w-full" title={chipName}>
            <span className="min-w-0 truncate">{chipName}</span>
          </span>
        </div>
      )}

      <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <p className="text-[13px] text-faint">{contextName ? `Preguntá sobre ${contextName}` : "Preguntá lo que necesites"}</p>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex flex-col items-end gap-1">
              {t.attachments && (
                <div className="flex max-w-[88%] flex-wrap justify-end gap-1">
                  {t.attachments.map((a) =>
                    a.kind === "image" && a.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={a.id} src={a.dataUrl} alt={a.name} className="max-h-28 rounded-md border border-border" />
                    ) : (
                      <span key={a.id} className="tag">
                        <FileText className="h-3 w-3" strokeWidth={1.75} />
                        {a.name}
                      </span>
                    ),
                  )}
                </div>
              )}
              {t.content && (
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-md bg-surface-raised px-2.5 py-1.5 text-[13px] leading-5">
                  {t.content}
                </div>
              )}
            </div>
          ) : (
            <div key={t.id} className="space-y-1.5">
              {t.steps && t.steps.length > 0 && (
                <ul className="space-y-0.5">
                  {t.steps.map((s, i) => (
                    <li key={i} className={clsx("flex items-start gap-1.5 text-[12px]", s.ok ? "text-mint" : "text-amber")}>
                      {s.ok ? <Check className="mt-0.5 h-3 w-3 flex-none" strokeWidth={2} /> : <X className="mt-0.5 h-3 w-3 flex-none" strokeWidth={2} />}
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {t.failed ? (
                <p className="text-[13px] text-rose">{t.content}</p>
              ) : t.content ? (
                <Markdown text={t.content} />
              ) : t.working ? (
                <p className="text-[13px] text-faint">{t.working}</p>
              ) : busy && t.id === turns[turns.length - 1]?.id && !confirm ? (
                <p className="text-[13px] text-faint">Pensando…</p>
              ) : null}
              {confirm?.turnId === t.id && (
                <div className="space-y-2 rounded-md border border-rose bg-rose-tint p-2.5">
                  <p className="text-[13px] font-medium text-text">{confirm.title}</p>
                  {confirm.detail && <p className="text-[12px] text-muted">{confirm.detail}</p>}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => answerConfirm(true)}>
                      Eliminar
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => answerConfirm(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="text-[12px] text-faint">Fuentes: {t.sources.join(", ")}</p>
              )}
              {!t.failed && t.content && !busy && (
                <button
                  type="button"
                  onClick={() => insertAnswer(t.content)}
                  disabled={!note}
                  title={note ? undefined : "Abrí una nota para insertar"}
                  className="flex items-center gap-1 text-[12px] text-faint hover:text-text disabled:opacity-40 disabled:hover:text-faint"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Insertar en la nota
                </button>
              )}
            </div>
          ),
        )}
      </div>

      <div className="flex-none border-t border-border p-2">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <span key={a.id} className={clsx("tag max-w-full", a.status === "error" && "text-rose")} title={a.error ?? a.name}>
                {a.kind === "image" ? <ImageIcon className="h-3 w-3" strokeWidth={1.75} /> : <FileText className="h-3 w-3" strokeWidth={1.75} />}
                <span className="min-w-0 truncate">{a.status === "reading" ? `Leyendo ${a.name}…` : a.status === "error" ? (a.error ?? "Error") : a.name}</span>
                <button type="button" aria-label={`Quitar ${a.name}`} onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}>
                  <X className="h-3 w-3" strokeWidth={1.75} />
                </button>
              </span>
            ))}
          </div>
        )}
        {!powerful && attachments.some((a) => a.kind === "image") && (
          <p className="mb-1 text-[12px] text-amber">La IA liviana no ve imágenes. Elegí Qwen3.5 35B arriba.</p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={`${IMPORT_ACCEPT},image/*`}
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-icon btn-ghost flex-none"
            onClick={() => fileRef.current?.click()}
            aria-label="Adjuntar archivo o imagen"
            title="Adjuntar (PDF, Excel, PowerPoint, Word, imagen)"
          >
            <Paperclip strokeWidth={1.75} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={unavailable}
            placeholder={agentMode ? "Pedí o preguntá algo" : "Preguntá algo"}
            aria-label="Pregunta para el asistente"
            className="min-h-[32px] flex-1 resize-none rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] leading-5 text-text outline-none placeholder:text-faint hover:border-border-strong focus:border-primary disabled:opacity-50"
          />
          {busy ? (
            <button type="button" className="btn btn-sm btn-icon flex-none" onClick={stopAll} aria-label="Detener" title="Detener">
              <Square strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx("btn btn-primary btn-sm btn-icon flex-none", !canSend && "opacity-50")}
              onClick={() => void send(input)}
              disabled={!canSend || unavailable}
              aria-label="Enviar"
              title="Enviar (Enter)"
            >
              <Send strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
