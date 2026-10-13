"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { BookOpen, ExternalLink, Sparkles } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { degreeBadgeClass } from "@/lib/format";
import { useDegreeMap } from "@/lib/hooks";
import { SUBJECT_STATUS_LABEL, type SubjectStatus } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { FlashcardsTab } from "@/components/flashcards/flashcards-tab";
import { NotesWorkspace } from "@/components/notes/notes-workspace";
import { createNote, paragraphBlocks } from "@/components/notes/note-utils";

// La bibliografía trae el lector de PDF: se carga sólo al abrir la pestaña.
const Bibliography = dynamic(() => import("@/components/pdf/bibliography").then((m) => m.Bibliography), {
  ssr: false,
  loading: () => <div className="t-small text-muted">Cargando la bibliografía…</div>,
});

type Tab = "apuntes" | "bibliografia" | "flashcards";

const TABS: { key: Tab; label: string }[] = [
  { key: "apuntes", label: "Apuntes" },
  { key: "bibliografia", label: "Bibliografía" },
  { key: "flashcards", label: "Flashcards" },
];

const STATUS_BADGE: Record<SubjectStatus, string> = {
  PENDIENTE: "badge",
  CURSANDO: "badge badge-primary",
  REGULAR: "badge badge-mint",
  APROBADA: "badge badge-mint",
};

export default function MateriaPage() {
  return (
    <Suspense fallback={null}>
      <MateriaFromUrl />
    </Suspense>
  );
}

// La materia viene en la URL (/materia?id=...) para que la app funcione como archivos estáticos en el .exe.
function MateriaFromUrl() {
  const id = useSearchParams().get("id") ?? "";
  // key: al cambiar de materia se reinician las pestañas y el apunte elegido.
  return <MateriaView key={id} subjectId={id} />;
}

function MateriaView({ subjectId }: { subjectId: string }) {
  const { setCurrentSubjectId, setAiOpen } = useAppState();
  const degrees = useDegreeMap();
  // null = no existe; undefined = todavía cargando
  const subject = useLiveQuery(async () => (await db.subjects.get(subjectId)) ?? null, [subjectId]);
  const [tab, setTab] = useState<Tab>("apuntes");
  const [noteId, setNoteId] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setCurrentSubjectId(subjectId);
    return () => setCurrentSubjectId(undefined);
  }, [subjectId, setCurrentSubjectId]);

  // Desde la bibliografía: el texto del PDF pasa a un apunte nuevo, que se abre enseguida.
  const openDocumentAsNote = async (documentId: string) => {
    const doc = await db.documents.get(documentId);
    if (!doc) return;
    try {
      const id = await createNote({
        subjectId,
        title: doc.fileName,
        unitNumber: doc.unitNumber,
        content: paragraphBlocks(doc.extractedText),
        plainTextCache: doc.extractedText,
      });
      setNotice(undefined);
      setNoteId(id);
      setTab("apuntes");
    } catch {
      setNotice("No pudimos abrir el documento como apunte. Probá de nuevo.");
    }
  };

  if (subject === undefined) {
    return <div className="p-6 t-small text-muted">Cargando la materia…</div>;
  }

  if (subject === null) {
    return (
      <div className="p-6">
        <EmptyState
          icon={BookOpen}
          title="No encontramos esta materia"
          text="Puede que se haya borrado o que el enlace esté mal."
          action={
            <Link href="/carreras" className="btn btn-sm">
              Ir a Mis carreras
            </Link>
          }
        />
      </div>
    );
  }

  const degree = degrees[subject.degreeId];

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="t-h1">{subject.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {degree && <span className={degreeBadgeClass(degree)}>{degree.shortName}</span>}
            <span className={STATUS_BADGE[subject.status]}>{SUBJECT_STATUS_LABEL[subject.status]}</span>
            <span className="t-small text-muted">
              {subject.year}.º año · {subject.semester}C
            </span>
            {subject.campusUrl && (
              <a
                href={subject.campusUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                Campus
                <ExternalLink />
              </a>
            )}
            {subject.driveUrl && (
              <a
                href={subject.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                Drive
                <ExternalLink />
              </a>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-ai btn-sm" onClick={() => setAiOpen(true)}>
          <Sparkles />
          Preguntarle a la IA
        </button>
      </header>

      <nav role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 t-small font-medium transition-colors",
              tab === t.key ? "border-primary text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {notice && <p className="t-small text-rose">{notice}</p>}

      <div role="tabpanel">
        {tab === "apuntes" && <NotesWorkspace subjectId={subjectId} selectedId={noteId} onSelect={setNoteId} />}
        {tab === "bibliografia" && (
          <Bibliography subjectId={subjectId} onOpenAsNote={(documentId) => void openDocumentAsNote(documentId)} />
        )}
        {tab === "flashcards" && <FlashcardsTab subjectId={subjectId} />}
      </div>
    </div>
  );
}
