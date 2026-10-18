"use client";

// Chat de IA del panel derecho. Usa la materia o la nota de la vista activa como contexto.
// Con la IA potente (en esta PC) además actúa: crea tareas, carga cronogramas, busca en internet, etc.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, Brain, Check, Copy, FileText, Film, Image as ImageIcon, Paperclip, Send, Settings2, Sparkles, Square, SquarePen, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db, newId } from "@/lib/db";
import { useLocalAI, type ChatMessage } from "@/lib/ai/use-local-ai";
import { buildSubjectContext } from "@/lib/ai/rag";
import { blocksToMarkdown } from "@/lib/notes/md-blocks";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER } from "@/lib/types";
import { isSummaryRequest, summarize, summarySources } from "@/lib/ai/summarize";
import { useWorkspace, type ViewState } from "@/lib/workspace";
import { noteTitle, specialFolderName } from "@/lib/panes/note-data";
import { useActiveNoteId, useNote } from "@/lib/panes/hooks";
import { LOCAL_MODELS, useAISettings, writeAISettings, type LocalModel } from "@/lib/ai/ai-settings";
import { tierModels } from "@/lib/ai/models";
import { AGENT_SYSTEM, runAgent } from "@/lib/ai/agent";
import { situationText } from "@/lib/ai/tools";
import type { ApiMessage, ContentPart } from "@/lib/ai/server";
import { convertFile, fileKind, IMPORT_ACCEPT } from "@/lib/import/import-file";
import { fmtTime, isVideoFile, videoFrames, videoInfo, videoInfoText, videoLinksIn } from "@/lib/video";
import { Markdown } from "./markdown";
import { Select } from "@/components/ui/select";
import { t, t as tr } from "@/lib/i18n"; // tr: dentro de turns.map, donde `t` es el turno

// Copia el texto al portapapeles y muestra un check un momento.
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={t("Copiar")}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
      className="flex items-center gap-1 text-[length:calc(12px*var(--ui-scale,1))] text-faint hover:text-text"
    >
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {done ? t("Copiado") : t("Copiar")}
    </button>
  );
}

// Selector del modo: Low, Default y Ultra son los Qwen 3.5 descargados, de menor a mayor.
function ModelPicker() {
  const s = useAISettings();
  const ai = useLocalAI();
  const tiers = tierModels(ai.catalog);
  const size = (id?: string) => ai.catalog?.models.find((m) => m.id === id)?.label.replace("Qwen3.5 ", "");
  const label = (id: LocalModel, base: string) => {
    if (id === "low" || id === "default" || id === "ultra") return tiers[id] ? `${base} · ${size(tiers[id].id)}` : base;
    if (id === "auto" && ai.currentModel && s.localModel === "auto") return `${base} · ${size(ai.currentModel)}`;
    return base;
  };
  return (
    <Select
      aria-label={t("Modelo de IA")}
      className="h-7 min-w-0 max-w-full cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1.5 text-[length:calc(13px*var(--ui-scale,1))] text-muted outline-none hover:border-border hover:bg-surface-raised focus:border-primary"
      value={s.localModel}
      onChange={(e) => writeAISettings({ localModel: e.target.value as LocalModel })}
    >
      {LOCAL_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {label(m.id, m.label)}
        </option>
      ))}
    </Select>
  );
}

interface Attachment {
  id: string;
  name: string;
  kind: "image" | "doc" | "video";
  status: "reading" | "ready" | "error";
  text?: string;
  dataUrl?: string;
  frames?: { t: number; dataUrl: string }[]; // video: fotogramas repartidos
  duration?: number;
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
const NOTE_CHARS = 1500; // texto de la nota abierta que entra en el contexto (chat simple)
const OPEN_NOTE_CHARS = 16000; // la nota abierta entera, en Markdown, para que la IA potente la pueda editar
const DOC_CHARS = 24000; // texto de un archivo adjunto que entra en el mensaje
const AGENT_KEEP = 40; // mensajes de la conversación que se le mandan a la IA potente

const TOOL_WORKING: Record<string, string> = {
  buscar_web: t("Buscando en internet…"),
  leer_pagina: t("Leyendo la página…"),
  leer_video: t("Leyendo el video…"),
  cargar_cronograma: t("Cargando el cronograma…"),
  buscar_notas: t("Buscando en tus apuntes…"),
  listar_tareas: t("Revisando tu agenda…"),
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

// "Mejorá esta lista", "corregí la ortografía": el pedido es sobre la nota abierta, no hace falta buscar en otras.
const ABOUT_OPEN_NOTE =
  /\b(est[ae]|la|el)\s+(nota|lista|p[aá]gina|apunte|texto|documento)\b|\b(edit|mejor|correg|arregl|orden|reescrib|redact|ortograf|resum|complet)/i;
const SPECIAL_FOLDERS = new Set([LOOSE_FOLDER, DAILY_FOLDER, IDEAS_FOLDER, TEMPLATES_FOLDER]);

// Links de los videos embebidos en una nota.
function videosOfNote(blocks: unknown[]): string[] {
  const out: string[] = [];
  const walk = (list: unknown[]) => {
    for (const b of list as { type?: string; props?: { url?: string }; children?: unknown[] }[]) {
      if (b.type === "videoEmbed" && b.props?.url) out.push(b.props.url);
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

export function AIChatPane() {
  const { currentSubjectId } = useAppState();
  const { activeView, openView } = useWorkspace();
  const ai = useLocalAI();
  const settings = useAISettings();
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
      const kind = isVideoFile(file) ? "video" : fileKind(file);
      const att: Attachment = {
        id: newId(),
        name: file.name || t("imagen"),
        kind: kind === "image" ? "image" : kind === "video" ? "video" : "doc",
        status: "reading",
      };
      setAttachments((prev) => [...prev, att]);
      const done = (patch: Partial<Attachment>) => setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, ...patch } : a)));
      (async () => {
        if (kind === "image") {
          const dataUrl = await imageToDataUrl(file);
          done({ status: "ready", dataUrl });
          return;
        }
        if (kind === "video") {
          const { duration, frames } = await videoFrames(file, 8);
          done({ status: "ready", frames, duration, dataUrl: frames[0]?.dataUrl });
          return;
        }
        const c = await convertFile(file);
        done({ status: "ready", text: c.text.slice(0, DOC_CHARS) });
      })().catch((err) => done({ status: "error", error: err instanceof Error ? err.message : t("No pudimos leer el archivo.") }));
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

    // "Hacé un resumen de la bibliografía": se lee el documento entero por partes, no por palabras clave.
    if (subjectId && !atts.length && isSummaryRequest(text)) {
      const sources = await summarySources(subjectId, text, note ? { title: noteTitle(note), plainTextCache: note.plainTextCache } : null);
      if (sources.length) {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Resumir documentos enteros: en Automático, el modelo más grande.
        await ai.load({ text, chars: 100_000 });
        ai.setBusy(true);
        try {
          const answer = await summarize(ai, sources, {
            topic: text,
            signal: ctrl.signal,
            onProgress: (label) => patchTurn(aiId, { working: label }),
            onText: (t) => patchTurn(aiId, { content: t, working: undefined }),
          });
          if (answer) {
            apiRef.current.push({ role: "user", content: text }, { role: "assistant", content: answer.slice(0, 1500) });
            patchTurn(aiId, { content: answer, working: undefined, sources: sources.map((x) => x.label) });
          } else {
            patchTurn(aiId, { content: ctrl.signal.aborted ? "" : tr("No llegué a armar el resumen. Probá de nuevo."), working: undefined });
          }
        } finally {
          ai.setBusy(false);
          abortRef.current = null;
        }
        return;
      }
    }

    // Material de los apuntes (si hay una materia o nota en pantalla).
    let material = "";
    let sources: string[] = [];
    const docChars = DOC_CHARS;
    const noteChars = OPEN_NOTE_CHARS;
    // Con una nota abierta, otras notas sólo suman si son de la misma materia y la pregunta no es sobre esta nota
    // (en Ideas o Notas sueltas cada nota es de un tema distinto y confunden a la IA).
    const searchOthers = !note || (!!subjectId && !SPECIAL_FOLDERS.has(subjectId) && !ABOUT_OPEN_NOTE.test(text));
    if (subjectId && text.length > 3 && searchOthers) {
      try {
        const found = await buildSubjectContext(subjectId, text, 3, note?.id);
        material = found.context;
        sources = found.sources.map((s) => s.label);
      } catch {
        // seguimos sin material
      }
    }
    const noteMd = note ? blocksToMarkdown(note.content).trim() : "";
    const openNote = noteMd
      ? `NOTA ABIERTA «${noteTitle(note!)}» (es lo que el usuario está viendo; si pide cambiarla, usá editar_nota sobre esta nota)` +
        `${noteMd.length > noteChars ? ". Es larga: acá va el principio, leela entera con leer_nota antes de reescribirla" : ""}:\n"""\n${noteMd.slice(0, noteChars)}\n"""`
      : "";

    // Links de video en el mensaje: se lee la transcripción antes de preguntar.
    const videoTexts: string[] = [];
    for (const v of videoLinksIn(text).slice(0, 2)) {
      patchTurn(aiId, { working: tr("Leyendo el video…") });
      try {
        const info = await videoInfo(v, 20000);
        videoTexts.push(videoInfoText(info));
        const label = info.transcripcion ? `Leí el video «${info.titulo}»` : `«${info.titulo}» no tiene transcripción`;
        patchTurn(aiId, (t) => ({ steps: [...(t.steps ?? []), { label, ok: !!info.transcripcion }] }));
      } catch {
        // la IA puede intentar con leer_video
      }
    }
    patchTurn(aiId, { working: undefined });
    const noteVideos = note ? videosOfNote(note.content) : [];

    const parts: string[] = [];
    if (contextName) parts.push(`[El usuario está viendo: ${note ? `la nota «${noteTitle(note)}»` : ""}${note && subjectName ? " de " : ""}${subjectName ?? ""}]`);
    if (noteVideos.length) parts.push(`[La nota abierta tiene estos videos (usá leer_video si te preguntan por ellos): ${noteVideos.join(" ")}]`);
    parts.push(...videoTexts);
    for (const a of atts.filter((a) => a.kind === "video")) {
      parts.push(
        a.frames?.length
          ? `[Video adjunto: ${a.name}, dura ${fmtTime(a.duration ?? 0)}. Van ${a.frames.length} fotogramas en orden, de los minutos ${a.frames.map((f) => fmtTime(f.t)).join(", ")}. No tenés el audio.]`
          : `[Video adjunto: ${a.name}, dura ${fmtTime(a.duration ?? 0)}. No se pudieron sacar fotogramas: pedile que pegue el link de YouTube.]`,
      );
    }
    for (const a of atts.filter((a) => a.kind === "doc" && a.text)) parts.push(`[Archivo adjunto: ${a.name}]\n"""\n${a.text!.slice(0, docChars)}\n"""`);
    if (openNote) parts.push(openNote);
    if (material) parts.push(`MATERIAL de otras notas y de la bibliografía (sólo si sirve para la pregunta; no lo mezcles con la nota abierta):\n${material}`);
    parts.push(text || "(mirá el adjunto)");
    const textPart = parts.join("\n\n");
    const images: ContentPart[] = [];
    for (const a of atts) {
      if (a.kind === "image" && a.dataUrl) images.push({ type: "image_url", image_url: { url: a.dataUrl } });
      if (a.kind === "video")
        for (const f of a.frames ?? []) {
          images.push({ type: "text", text: `[${a.name} · ${fmtTime(f.t)}]` });
          images.push({ type: "image_url", image_url: { url: f.dataUrl } });
        }
    }
    const content: string | ContentPart[] = images.length ? [...images, { type: "text" as const, text: textPart }] : textPart;

    apiRef.current.push({ role: "user", content });
    const messages = compactHistory(apiRef.current, AGENT_KEEP);
    const sent = messages.length;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    await ai.load({ text, chars: textPart.length, images: images.length > 0, think: settings.think });
    ai.setBusy(true);
    try {
      const common = {
        signal: ctrl.signal,
        ctx: {
          confirm: (title: string, detail: string) => askConfirm(aiId, title, detail),
          openView: (v: ViewState) => openView(v, "tab"),
          userText: text,
          noteId: note?.id,
        },
        events: {
          onText: (t: string) => patchTurn(aiId, { content: t, working: undefined }),
          onToolStart: (name: string) => patchTurn(aiId, { working: TOOL_WORKING[name] ?? "Trabajando…" }),
          onTool: (label: string, ok: boolean) => patchTurn(aiId, (t) => ({ steps: [...(t.steps ?? []), { label, ok }], working: undefined })),
        },
      };
      const final = await runAgent(messages, { ...common, think: settings.think });
      // Lo nuevo (respuestas y resultados) queda en la conversación.
      apiRef.current.push(...messages.slice(sent));
      patchTurn(aiId, (t) => ({
        content: final.trim() || (t.steps?.length ? "" : tr("No llegué a responder. Probá de nuevo.")),
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
      content: answer.trim() ? answer : tr("No llegué a responder. Probá de nuevo."),
      sources: sources.length > 0 ? [...new Set(sources)] : undefined,
    });
  }

  async function send(raw: string) {
    const text = raw.trim();
    const atts = attachments.filter((a) => a.status === "ready");
    if ((!text && !atts.length) || busy) return;
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
        content: err instanceof Error ? err.message : t("No pudimos responder. Probá de nuevo."),
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
      case "loading": {
        const pct = Math.round(ai.progress * 100);
        return (
          <div className="min-w-0 flex-1 space-y-1">
            {!agentMode && (
              <div className="progress h-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="truncate text-[length:calc(12px*var(--ui-scale,1))] text-faint">{ai.progressText || tr("Preparando la IA…")}</p>
          </div>
        );
      }
      case "error":
        return (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[length:calc(13px*var(--ui-scale,1))] text-rose" title={ai.error}>
              {ai.error ?? tr("No pudimos preparar la IA. Probá de nuevo.")}
            </p>
            <button type="button" onClick={activate} className="flex-none text-[length:calc(13px*var(--ui-scale,1))] text-primary-soft underline underline-offset-2">
              {tr("Reintentar")}
            </button>
          </div>
        );
      case "idle":
        return (
          <button type="button" onClick={activate} className="btn btn-ai btn-sm flex-none whitespace-nowrap">
            {tr("Activar")}
          </button>
        );
      case "generating":
        return <span className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{t("Trabajando…")}</span>;
      default:
        return <span className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{t("Lista")}</span>;
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
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary-tint/80 text-[length:calc(13px*var(--ui-scale,1))] text-text">
          {tr("Soltá para adjuntar")}
        </div>
      )}

      <div className="flex min-h-9 flex-none items-center gap-1 px-3 py-1.5">
        <div className="min-w-0 flex-[0_1_auto]">
          <ModelPicker />
        </div>
        {agentMode && (
          <>
            {<button
              type="button"
              className={clsx("icon-btn flex-none", settings.think && "text-primary-soft")}
              onClick={() => writeAISettings({ think: !settings.think })}
              aria-pressed={settings.think}
              title={settings.think ? tr("Razona antes de responder (más lento)") : tr("Responde directo (más rápido)")}
            >
              <Brain strokeWidth={1.75} />
            </button>}
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end">{renderStatus()}</div>
        <button
          type="button"
          className="icon-btn flex-none"
          onClick={() => openView({ type: "ajustes", section: "ia" }, "tab")}
          aria-label={t("Descargar o elegir IA")}
          title={t("Descargar o elegir IA")}
        >
          <Settings2 strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn flex-none disabled:opacity-40"
          onClick={newConversation}
          disabled={turns.length === 0}
          aria-label={t("Nueva conversación")}
          title={t("Nueva conversación")}
        >
          <SquarePen strokeWidth={1.75} />
        </button>
      </div>

      {chipName && (
        <div className="flex-none px-4 pb-1">
          <span className="tag max-w-full" title={chipName}>
            <span className="min-w-0 truncate">{chipName}</span>
          </span>
        </div>
      )}

      <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Sparkles className="h-6 w-6 text-faint" strokeWidth={1.5} />
            <p className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{contextName ? tr("Preguntá sobre {name}", { name: contextName }) : tr("Preguntá lo que necesites")}</p>
          </div>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex flex-col items-end gap-1">
              {t.attachments && (
                <div className="flex max-w-[88%] flex-wrap justify-end gap-1">
                  {t.attachments.map((a) =>
                    a.kind === "video" ? (
                      <span key={a.id} className="flex flex-col items-end gap-1">
                        {a.dataUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.dataUrl} alt={a.name} className="max-h-28 rounded-md border border-border" />
                        )}
                        <span className="tag">
                          <Film className="h-3 w-3" strokeWidth={1.75} />
                          {a.name}
                        </span>
                      </span>
                    ) : a.kind === "image" && a.dataUrl ? (
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
                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-md bg-surface-raised px-2.5 py-1.5 text-[length:calc(13px*var(--ui-scale,1))] leading-5">
                  {t.content}
                </div>
              )}
              {t.content && <CopyButton text={t.content} />}
            </div>
          ) : (
            <div key={t.id} className="space-y-1.5">
              {t.steps && t.steps.length > 0 && (
                <ul className="space-y-0.5">
                  {t.steps.map((s, i) => (
                    <li key={i} className={clsx("flex items-start gap-1.5 text-[length:calc(12px*var(--ui-scale,1))]", s.ok ? "text-mint" : "text-amber")}>
                      {s.ok ? <Check className="mt-0.5 h-3 w-3 flex-none" strokeWidth={2} /> : <X className="mt-0.5 h-3 w-3 flex-none" strokeWidth={2} />}
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {t.failed ? (
                <p className="text-[length:calc(13px*var(--ui-scale,1))] text-rose">{t.content}</p>
              ) : t.content ? (
                <Markdown text={t.content} />
              ) : t.working ? (
                <p className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{t.working}</p>
              ) : busy && t.id === turns[turns.length - 1]?.id && !confirm ? (
                <p className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{tr("Pensando…")}</p>
              ) : null}
              {confirm?.turnId === t.id && (
                <div className="space-y-2 rounded-md border border-rose bg-rose-tint p-2.5">
                  <p className="text-[length:calc(13px*var(--ui-scale,1))] font-medium text-text">{confirm.title}</p>
                  {confirm.detail && <p className="text-[length:calc(12px*var(--ui-scale,1))] text-muted">{confirm.detail}</p>}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => answerConfirm(true)}>
                      {tr("Eliminar")}
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => answerConfirm(false)}>
                      {tr("Cancelar")}
                    </button>
                  </div>
                </div>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="text-[length:calc(12px*var(--ui-scale,1))] text-faint">Fuentes: {t.sources.join(", ")}</p>
              )}
              {!t.failed && t.content && !busy && (
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton text={t.content} />
                  <button
                    type="button"
                    onClick={() => insertAnswer(t.content)}
                    disabled={!note}
                    title={note ? undefined : tr("Abrí una nota para insertar")}
                    className="flex items-center gap-1 text-[length:calc(12px*var(--ui-scale,1))] text-faint hover:text-text disabled:opacity-40 disabled:hover:text-faint"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {tr("Insertar en la nota")}
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <div className="flex-none border-t border-border px-4 py-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <span key={a.id} className={clsx("tag max-w-full", a.status === "error" && "text-rose")} title={a.error ?? a.name}>
                {a.kind === "image" ? <ImageIcon className="h-3 w-3" strokeWidth={1.75} /> : a.kind === "video" ? <Film className="h-3 w-3" strokeWidth={1.75} /> : <FileText className="h-3 w-3" strokeWidth={1.75} />}
                <span className="min-w-0 truncate">{a.status === "reading" ? `Leyendo ${a.name}…` : a.status === "error" ? (a.error ?? "Error") : a.name}</span>
                <button type="button" aria-label={`Quitar ${a.name}`} onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))}>
                  <X className="h-3 w-3" strokeWidth={1.75} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={`${IMPORT_ACCEPT},image/*,video/*`}
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-icon btn-ghost flex-none"
            onClick={() => fileRef.current?.click()}
            aria-label={t("Adjuntar archivo o imagen")}
            title={t("Adjuntar (PDF, Excel, PowerPoint, Word, imagen, video)")}
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
            
            placeholder={agentMode ? tr("Pedí o preguntá algo") : tr("Preguntá algo")}
            aria-label={t("Pregunta para el asistente")}
            className="min-h-[32px] min-w-0 flex-1 resize-none rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[length:calc(13px*var(--ui-scale,1))] leading-5 text-text outline-none placeholder:text-faint hover:border-border-strong focus:border-primary disabled:opacity-50"
          />
          {busy ? (
            <button type="button" className="btn btn-sm btn-icon flex-none" onClick={stopAll} aria-label={t("Detener")} title={t("Detener")}>
              <Square strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx("btn btn-primary btn-sm btn-icon flex-none", !canSend && "opacity-50")}
              onClick={() => void send(input)}
              disabled={!canSend}
              aria-label={t("Enviar")}
              title={t("Enviar (Enter)")}
            >
              <Send strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
