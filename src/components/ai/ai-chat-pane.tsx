"use client";

// Chat de IA del panel derecho. Usa la materia o la nota de la vista activa como contexto.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, Send, Square, SquarePen } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db, newId } from "@/lib/db";
import { useLocalAI, type ChatMessage } from "@/lib/ai/use-local-ai";
import { buildSubjectContext } from "@/lib/ai/rag";
import { useWorkspace } from "@/lib/workspace";
import { noteTitle, specialFolderName } from "@/lib/panes/note-data";
import { useActiveNoteId, useNote } from "@/lib/panes/hooks";
import { Markdown } from "./markdown";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  failed?: boolean;
}

const HISTORY_TURNS = 6;
const HISTORY_CHARS_USER = 800;
const HISTORY_CHARS_ASSISTANT = 600;
const NOTE_CHARS = 1500; // texto de la nota abierta que entra en el contexto

function buildSystemPrompt(contextName: string | undefined, material: string): string {
  const base =
    "Sos un tutor universitario. Explicás con claridad, en español rioplatense (usá vos), en pasos cortos y con ejemplos cuando ayudan. " +
    "Usá Markdown liviano: listas, negritas y tablas cuando comparás cosas. No inventes datos ni citas.";
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

export function AIChatPane() {
  const { currentSubjectId } = useAppState();
  const { activeView } = useWorkspace();
  const ai = useLocalAI();

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const unavailable = ai.status === "unsupported";

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
  }, [turns]);

  const patchTurn = (id: string, patch: Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy || unavailable) return;

    const history: ChatMessage[] = turns
      .filter((t) => !t.failed && t.content.trim())
      .slice(-HISTORY_TURNS)
      .map((t) => ({
        role: t.role,
        content: t.content.slice(0, t.role === "assistant" ? HISTORY_CHARS_ASSISTANT : HISTORY_CHARS_USER),
      }));
    // La pregunta anterior también sirve para buscar contexto ("y eso cómo se calcula?").
    const previousQuestion = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";

    const aiId = newId();
    setTurns((prev) => [
      ...prev,
      { id: newId(), role: "user", content: text },
      { id: aiId, role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);

    try {
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
    } catch (err) {
      patchTurn(aiId, {
        content: err instanceof Error ? err.message : "No pudimos responder. Probá de nuevo.",
        failed: true,
      });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  function newConversation() {
    if (busy) ai.stop();
    setTurns([]);
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
            <div className="progress h-1" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="truncate text-[12px] text-faint">{ai.progressText}</p>
          </div>
        );
      }
      case "error":
        return (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] text-rose">{ai.error ?? "No pudimos preparar la IA. Probá de nuevo."}</p>
            <button type="button" onClick={activate} className="flex-none text-[13px] text-primary-soft underline underline-offset-2">
              Reintentar
            </button>
          </div>
        );
      case "idle":
        return (
          <button type="button" onClick={activate} className="text-[13px] text-primary-soft underline underline-offset-2">
            Activar IA
          </button>
        );
      default:
        return <span className="text-[13px] text-faint">Lista</span>;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-9 flex-none items-center gap-2 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center">{renderStatus()}</div>
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
            <div key={t.id} className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-md bg-surface-raised px-2.5 py-1.5 text-[13px] leading-5">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={t.id} className="space-y-1.5">
              {t.failed ? (
                <p className="text-[13px] text-rose">{t.content}</p>
              ) : t.content ? (
                <Markdown text={t.content} />
              ) : (
                <p className="text-[13px] text-faint">Pensando…</p>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="text-[12px] text-faint">Fuentes: {t.sources.join(", ")}</p>
              )}
              {!t.failed && t.content && (
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
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={unavailable}
            placeholder="Preguntá algo"
            aria-label="Pregunta para el asistente"
            className="min-h-[32px] flex-1 resize-none rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] leading-5 text-text outline-none placeholder:text-faint hover:border-border-strong focus:border-primary disabled:opacity-50"
          />
          {busy ? (
            <button type="button" className="btn btn-sm btn-icon flex-none" onClick={() => ai.stop()} aria-label="Detener" title="Detener">
              <Square strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              className={clsx("btn btn-primary btn-sm btn-icon flex-none", !input.trim() && "opacity-50")}
              onClick={() => void send(input)}
              disabled={!input.trim() || unavailable}
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
