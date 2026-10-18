"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { deleteWithUndo } from "@/lib/undo";
import { BookOpen, Check, Copy, Download, Eye, FileText, NotebookPen, Trash } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import type { SubjectDocument } from "@/lib/types";
import { PdfImportButton } from "./pdf-import-button";
import { t } from "@/lib/i18n";

interface Props {
  subjectId: string;
  onOpenAsNote?: (documentId: string) => void;
}

// Bibliography de la materia: PDFs ya convertidos a texto.
export function Bibliography({ subjectId, onOpenAsNote }: Props) {
  const docs = useLiveQuery(
    () =>
      db.documents
        .where("subjectId")
        .equals(subjectId)
        .toArray()
        .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    [subjectId],
  );

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewing = docs?.find((d) => d.id === viewingId) ?? null;

  function closeViewer() {
    setViewingId(null);
    setCopied(false);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("No pudimos copiar el texto. Seleccionalo a mano."));
    }
  }

  async function downloadOriginal(doc: SubjectDocument) {
    if (!doc.fileId) return;
    try {
      const file = await db.files.get(doc.fileId);
      if (!file) {
        setError(t("No encontramos el archivo original."));
        return;
      }
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t("No pudimos descargar el archivo. Probá de nuevo."));
    }
  }

  async function removeDocument(doc: SubjectDocument) {
    try {
      await deleteWithUndo(t("Se eliminó «{name}»", { name: doc.fileName }), () =>
        db.transaction("rw", db.documents, db.files, async () => {
          await db.documents.delete(doc.id);
          if (doc.fileId) await db.files.delete(doc.fileId);
        }),
      );
      setConfirmingId(null);
    } catch {
      setError(t("No pudimos eliminar el documento. Probá de nuevo."));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="t-small text-muted">
          {docs ? (docs.length === 1 ? t("{n} documento", { n: docs.length }) : t("{n} documentos", { n: docs.length })) : ""}
        </div>
        <PdfImportButton
          subjectId={subjectId}
          onImported={(_, documentId) => setViewingId(documentId)}
        />
      </div>

      {error && (
        <p role="alert" className="t-small text-rose">
          {error}
        </p>
      )}

      {docs && docs.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title={t("Subí la bibliografía de la materia")}
          text={t("Los PDFs se pasan a texto para que los puedas leer, buscar y preguntarle a la IA.")}
        />
      )}

      {docs && docs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <li key={doc.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 flex-none text-muted" strokeWidth={1.75} />
                <div className="min-w-0">
                  <div className="t-body truncate text-text">{doc.fileName}</div>
                  <div className="t-small num text-muted">
                    {doc.pageCount === 1 ? t("{n} página · {date}", { n: doc.pageCount, date: shortDate(doc.createdAt) }) : t("{n} páginas · {date}", { n: doc.pageCount, date: shortDate(doc.createdAt) })}
                  </div>
                </div>
              </div>

              {confirmingId === doc.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-small text-muted">{t("¿Eliminar este documento?")}</span>
                  <button className="btn btn-danger btn-sm" onClick={() => void removeDocument(doc)}>
                    {t("Eliminar")}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingId(null)}>
                    {t("Cancelar")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewingId(doc.id)}>
                    <Eye strokeWidth={1.75} />
                    {t("Ver texto")}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void downloadOriginal(doc)} disabled={!doc.fileId}>
                    <Download strokeWidth={1.75} />
                    {t("Descargar original")}
                  </button>
                  {onOpenAsNote && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenAsNote(doc.id)}>
                      <NotebookPen strokeWidth={1.75} />
                      {t("Abrir como apunte")}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => void removeDocument(doc)}>
                    <Trash strokeWidth={1.75} />
                    {t("Eliminar")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={viewing !== null}
        onClose={closeViewer}
        title={viewing?.fileName ?? ""}
        width={640}
        footer={
          viewing && (
            <button className="btn btn-primary" onClick={() => void copyText(viewing.extractedText)}>
              {copied ? <Check strokeWidth={1.75} /> : <Copy strokeWidth={1.75} />}
              {copied ? t("Copiado") : t("Copiar")}
            </button>
          )
        }
      >
        {viewing && (
          <p className="whitespace-pre-wrap break-words t-body text-text">
            {viewing.extractedText || t("Este documento no tiene texto.")}
          </p>
        )}
      </Modal>
    </section>
  );
}
