"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Square, SquarePen, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { db, newId } from "@/lib/db";
import { useLocalAI, type ChatMessage } from "@/lib/ai/use-local-ai";
import { buildSubjectContext } from "@/lib/ai/rag";
import { Markdown } from "./markdown";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  failed?: boolean;
}

const QUICK_PROMPTS = ["Explicame con un ejemplo", "Armá un cuadro comparativo", "Tomame examen"];
const HISTORY_TURNS = 6;
const HISTORY_CHARS_USER = 800;
const HISTORY_CHARS_ASSISTANT = 600;

function buildSystemPrompt(subjectName: string | undefined, context: string): string {
  const base =
    "Sos un tutor universitario. Explicás con claridad, en español rioplatense (usá vos), en pasos cortos y con ejemplos cuando ayudan. " +
    "Usá Markdown liviano: listas, negritas y tablas cuando comparás cosas. No inventes datos ni citas.";
  if (!subjectName) {
    return `${base}\nNo hay una materia seleccionada, así que respondé con conocimiento general y aclarí cuando sea una suposición.`;
  }
  if (!context) {
    return `${base}\nLa materia es "${subjectName}", pero no encontramos apuntes relacionados con la pregunta. Respondé con conocimiento general y aclaralo al principio.`;
  }
  return (
    `${base}\nLa materia es "${subjectName}". Usá primero el MATERIAL que sigue. ` +
    "Si la respuesta no está ahí, decilo y completá con conocimiento general, aclarándolo.\n\n" +
    `MATERIAL:\n${context}`
  );
}

export function AIPanel() {
  const { aiOpen, setAiOpen, currentSubjectId } = useAppState();
  const ai = useLocalAI();
  const subject = useLiveQuery(
    () => (currentSubjectId ? db.subjects.get(currentSubjectId) : undefined),
    [currentSubjectId],
  );

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const unavailable = ai.status === "unsupported";

  // Esc cierra el panel; al abrir, el foco va al campo de texto.
  useEffect(() => {
    if (!aiOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAiOpen(false);
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [aiOpen, setAiOpen]);

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
      if (currentSubjectId) {
        try {
          const found = await buildSubjectContext(currentSubjectId, `${previousQuestion} ${text}`);
          context = found.context;
          sources = found.sources.map((s) => s.label);
        } catch {
          // Sin contexto igual respondemos, pero la IA lo aclara.
        }
      }

      const messages: ChatMessage[] = [
        { role: "system", content: buildSystemPrompt(subject?.name, context) },
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

  function renderStatus() {
    switch (ai.status) {
      case "unsupported":
        return (
          <p className="t-small text-muted">
            Tu navegador no puede correr la IA. Probá con Chrome o Edge actualizados.
          </p>
        );
      case "loading": {
        const pct = Math.round(ai.progress * 100);
        return (
          <div className="space-y-2">
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <p className="t-small text-muted">{ai.progressText}</p>
          </div>
        );
      }
      case "error":
        return (
          <div className="flex items-center justify-between gap-3">
            <p className="t-small text-rose">{ai.error ?? "No pudimos preparar la IA. Probá de nuevo."}</p>
            <button type="button" className="btn btn-sm shrink-0" onClick={activate}>
              Reintentar
            </button>
          </div>
        );
      case "idle":
        return (
          <div className="flex items-center justify-between gap-3">
            <p className="t-small text-muted">Corre en tu navegador. Se descarga una sola vez.</p>
            <button type="button" className="btn btn-ai btn-sm shrink-0" onClick={activate}>
              <Sparkles />
              Activar IA
            </button>
          </div>
        );
      default:
        return <p className="t-small text-muted">IA lista en tu navegador</p>;
    }
  }

  return (
    <aside
      aria-label="Asistente"
      inert={!aiOpen}
      className={clsx(
        "fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-border bg-surface shadow-pop transition-[transform,visibility] duration-200",
        aiOpen ? "visible translate-x-0" : "invisible translate-x-full",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={18} strokeWidth={1.75} className="shrink-0 text-primary-soft" />
          <h2 className="t-h2">Asistente</h2>
          {subject && <span className="badge min-w-0 max-w-[170px] truncate">{subject.name}</span>}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon shrink-0"
          onClick={() => setAiOpen(false)}
          aria-label="Cerrar asistente"
          title="Cerrar (Esc)"
        >
          <X strokeWidth={1.75} />
        </button>
      </header>

      <div className="border-b border-border px-4 py-3">{renderStatus()}</div>

      <div ref={threadRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <p className="t-small text-faint">
            {subject
              ? `Preguntame sobre ${subject.name} o pedí un repaso.`
              : "Preguntame lo que necesites. Si elegís una materia, uso sus apuntes."}
          </p>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-raised px-3 py-2 t-body">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={t.id}>
              {t.failed ? (
                <p className="t-body text-rose">{t.content}</p>
              ) : t.content ? (
                <Markdown text={t.content} />
              ) : (
                <p className="t-small text-faint">Pensando…</p>
              )}
              {t.sources && t.sources.length > 0 && (
                <p className="t-small mt-2 text-faint">Fuentes: {t.sources.join(", ")}</p>
              )}
            </div>
          ),
        )}
      </div>

      <div className="space-y-3 border-t border-border px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              className="btn btn-sm text-muted"
              disabled={unavailable || busy}
              onClick={() => {
                setInput(`${q} `);
                inputRef.current?.focus();
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={unavailable}
            placeholder="Escribí tu pregunta"
            aria-label="Pregunta para el asistente"
            className="input resize-none py-2"
            style={{ minHeight: 40, maxHeight: 160 }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm btn-icon shrink-0"
            onClick={() => void send(input)}
            disabled={!input.trim() || busy || unavailable}
            aria-label="Enviar"
            title="Enviar (Enter)"
          >
            <Send />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={newConversation}
            disabled={turns.length === 0}
          >
            <SquarePen />
            Nueva conversación
          </button>
          {busy && (
            <button type="button" className="btn btn-sm" onClick={() => ai.stop()}>
              <Square />
              Detener
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
