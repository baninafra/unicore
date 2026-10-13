"use client";

import clsx from "clsx";
import { FileUp } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { extractPdf, type PdfExtraction, type PdfProgress } from "@/lib/pdf/import-pdf";
import { savePdfDocument } from "@/lib/pdf/save-document";

interface Props {
  subjectId: string;
  onImported: (extraction: PdfExtraction, documentId: string) => void;
  className?: string;
  label?: string;
}

const READ_ERROR = "No pudimos leer el PDF. Probá con otro archivo.";
const SAVE_ERROR = "No pudimos guardar el PDF. Probá de nuevo.";

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function progressText(p: PdfProgress) {
  return p.stage === "ocr"
    ? `Reconociendo texto de la página ${p.page} de ${p.total}…`
    : `Leyendo página ${p.page} de ${p.total}…`;
}

// Botón para subir un PDF (o soltarlo encima) y pasarlo a texto.
export function PdfImportButton({ subjectId, onImported, className, label = "Importar PDF" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function importFile(file: File) {
    if (busy) return;
    if (!isPdf(file)) {
      setError("Ese archivo no es un PDF. Probá con otro.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Leyendo PDF…");
    let saving = false;
    try {
      const extraction = await extractPdf(file, (p) => setStatus(progressText(p)));
      saving = true;
      setStatus("Guardando…");
      const documentId = await savePdfDocument(file, extraction, subjectId);
      onImported(extraction, documentId);
    } catch {
      setError(saving ? SAVE_ERROR : READ_ERROR);
    } finally {
      setBusy(false);
      setStatus(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDragOver(e: DragEvent<HTMLButtonElement>) {
    if (busy) return;
    e.preventDefault();
    setDragOver(true);
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) void importFile(file);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={clsx("btn btn-sm", dragOver && "border-primary bg-primary-tint", className)}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <FileUp strokeWidth={1.75} />
        {busy && status ? status : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      {error && (
        <p role="alert" className="t-small text-rose">
          {error}
        </p>
      )}
    </div>
  );
}
