"use client";

import "@blocknote/mantine/style.css";
import "./editor.css";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { es } from "@blocknote/core/locales";
import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { ClipboardCheck, ImagePlus, Sparkles } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { generateFlashcards, generateQuiz, type FlashcardDraft, type QuizQuestion } from "@/lib/ai/prompts";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { db, nowIso, resolveFileUrl, saveFile } from "@/lib/db";
import type { PdfExtraction } from "@/lib/pdf/import-pdf";
import type { Note } from "@/lib/types";
import { FlashcardsReviewModal } from "@/components/flashcards/flashcards-review-modal";
import { MIN_CHARS_FOR_AI, plainTextOf } from "./note-utils";
import { QuizModal } from "./quiz-modal";

const PdfImportButton = dynamic(
  () => import("@/components/pdf/pdf-import-button").then((m) => m.PdfImportButton),
  { ssr: false },
);

const AUTOSAVE_MS = 1500;

type SaveState = "saved" | "pending" | "error";

function isEmptyBlock(block: Block) {
  return block.type === "paragraph" && Array.isArray(block.content) && block.content.length === 0;
}

// Editor de un apunte. Se monta con key={note.id}, así cada apunte tiene su propia instancia.
export function NoteEditor({ note }: { note: Note }) {
  const { theme } = useAppState();
  const ai = useLocalAI();

  const editor = useCreateBlockNote({
    dictionary: es,
    initialContent: note.content.length ? (note.content as PartialBlock[]) : undefined,
    uploadFile: (file) => saveFile(file),
    resolveFileUrl: (url) => resolveFileUrl(url),
  });

  // Autoguardado con debounce: guarda content, plainTextCache y updatedAt.
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Block[] | null>(null);

  const persist = useCallback(
    async (blocks: Block[]) => {
      try {
        await db.notes.update(note.id, {
          content: blocks,
          plainTextCache: plainTextOf(blocks),
          updatedAt: nowIso(),
        });
        // Si el usuario siguió escribiendo mientras se guardaba, queda "Guardando…" hasta el próximo guardado.
        if (!pending.current) setSaveState("saved");
      } catch {
        setSaveState("error");
        setNotice("No pudimos guardar el apunte. Probá de nuevo.");
      }
    },
    [note.id],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const blocks = pending.current;
    if (!blocks) return;
    pending.current = null;
    await persist(blocks);
  }, [persist]);

  useEffect(() => {
    const unsubscribe = editor.onChange((ed) => {
      pending.current = ed.document;
      setSaveState("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    });
    return () => {
      unsubscribe();
      // Al cambiar de apunte o salir de la materia, se guarda lo que quedó pendiente.
      void flush();
    };
  }, [editor, flush]);

  // Fotos: se guardan en IndexedDB y se insertan como bloque de imagen después del cursor.
  const fileInput = useRef<HTMLInputElement>(null);

  const addImage = async (file: File) => {
    try {
      const url = await saveFile(file);
      const cursor = editor.getTextCursorPosition().block;
      editor.insertBlocks([{ type: "image", props: { url } }], cursor, "after");
    } catch {
      setNotice("No pudimos guardar la foto. Probá con otra imagen.");
    }
  };

  // PDF: el texto se escribe al final del apunte, así queda editable.
  const onPdfImported = async (extraction: PdfExtraction) => {
    const { pdfToBlocks } = await import("@/lib/pdf/import-pdf");
    const blocks = pdfToBlocks(extraction) as PartialBlock[];
    if (!blocks.length) {
      setNotice("No encontramos texto en el PDF.");
      return;
    }
    const doc = editor.document;
    const last = doc[doc.length - 1];
    if (!last) return;
    if (doc.length === 1 && isEmptyBlock(last)) editor.replaceBlocks([last], blocks);
    else editor.insertBlocks(blocks, last, "after");
    setNotice(`Importamos "${extraction.fileName}" al final del apunte.`);
  };

  // IA: flashcards o examen a partir del texto del apunte.
  const [busy, setBusy] = useState<"cards" | "quiz" | null>(null);
  const [drafts, setDrafts] = useState<FlashcardDraft[] | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);

  const runAI = async (kind: "cards" | "quiz") => {
    await flush();
    const text = plainTextOf(editor.document);
    if (text.trim().length < MIN_CHARS_FOR_AI) {
      setNotice(
        kind === "cards"
          ? "Escribí un poco más en el apunte para generar tarjetas."
          : "Escribí un poco más en el apunte para tomar un examen.",
      );
      return;
    }
    setNotice(undefined);
    setBusy(kind);
    try {
      if (kind === "cards") {
        const result = await generateFlashcards(ai, text);
        if (result.length) setDrafts(result);
        else setNotice("No pudimos sacar tarjetas de este apunte. Probá agregar más texto.");
      } else {
        const result = await generateQuiz(ai, text);
        if (result.length) setQuiz(result);
        else setNotice("No pudimos armar el examen. Probá de nuevo.");
      }
    } catch {
      setNotice("No pudimos usar la IA para este apunte. Probá de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  const saveLabel = saveState === "saved" ? "Guardado" : saveState === "pending" ? "Guardando…" : "Sin guardar";

  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="t-h3 mr-auto min-w-0 truncate">{note.title}</div>
        <span className="t-small num text-faint">{saveLabel}</span>
        <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
          <ImagePlus />
          Agregar foto
        </button>
        <PdfImportButton
          subjectId={note.subjectId}
          label="Importar PDF"
          className="btn btn-sm"
          onImported={(extraction) => void onPdfImported(extraction)}
        />
        <button
          type="button"
          className="btn btn-ai btn-sm"
          disabled={busy !== null}
          onClick={() => void runAI("cards")}
        >
          <Sparkles />
          Generar flashcards
        </button>
        <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void runAI("quiz")}>
          <ClipboardCheck />
          Tomame examen
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void addImage(file);
          }}
        />
      </div>

      {notice && <p className="t-small px-4 pt-3 text-muted">{notice}</p>}

      {busy && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <p className="t-small text-muted">
            {ai.status === "loading" && ai.progressText ? ai.progressText : "Generando…"}
          </p>
          {ai.status === "loading" && (
            <div className="progress">
              <i style={{ width: `${Math.round(ai.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="unicore-editor min-h-0 flex-1 py-3">
        <BlockNoteView editor={editor} theme={theme} />
      </div>

      {drafts && (
        <FlashcardsReviewModal
          drafts={drafts}
          subjectId={note.subjectId}
          noteId={note.id}
          onClose={() => setDrafts(null)}
          onSaved={(count) => {
            setDrafts(null);
            setNotice(count === 1 ? "Se guardó 1 tarjeta." : `Se guardaron ${count} tarjetas.`);
          }}
        />
      )}

      {quiz && <QuizModal questions={quiz} onClose={() => setQuiz(null)} />}
    </div>
  );
}
