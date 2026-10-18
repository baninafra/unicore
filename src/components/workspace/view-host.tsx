"use client";

import dynamic from "next/dynamic";
import { t } from "@/lib/i18n";
import { Plus } from "lucide-react";
import type { ViewState } from "@/lib/workspace";
import { InicioView } from "@/views/inicio-view";
import { CalendarioView } from "@/views/calendario-view";
import { MailsView } from "@/views/mails-view";
import { RepasoView } from "@/views/repaso-view";
import { CarrerasView } from "@/views/carreras-view";
import { MateriaView } from "@/views/materia-view";
import { BusquedaView } from "@/views/busqueda-view";
import { WebView } from "@/views/web-view";
import { BaseView } from "@/views/base-view";
import { IdeasView } from "@/views/ideas-view";
import { QuizPage } from "@/views/quiz-page";
import { isQuizNote } from "@/lib/quiz/quiz-store";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";

// Los cuestionarios son notas, pero se abren como página para responder.
function NoteOrQuiz({ id }: { id: string }) {
  const note = useLiveQuery(() => db.notes.get(id), [id]);
  if (note && isQuizNote(note)) return <QuizPage note={note} />;
  return <NotaView id={id} />;
}
import { PlantillasView } from "@/views/plantillas-view";
import { NotificacionesView } from "@/views/notificaciones-view";
import { AjustesView } from "@/views/ajustes-view";
import { useWorkspace } from "@/lib/workspace";

// Las vistas pesadas (editor, grafo, lienzo) se cargan recién cuando se abren.
const Loading = () => <div className="p-6 t-small text-faint">{t("Cargando…")}</div>;
const NotaView = dynamic(() => import("@/views/nota-view").then((m) => m.NotaView), { ssr: false, loading: Loading });
const GrafoView = dynamic(() => import("@/views/grafo-view").then((m) => m.GrafoView), { ssr: false, loading: Loading });
const CanvasView = dynamic(() => import("@/views/canvas-view").then((m) => m.CanvasView), { ssr: false, loading: Loading });
const PdfView = dynamic(() => import("@/views/pdf-view").then((m) => m.PdfView), { ssr: false, loading: Loading });
const EditorView = dynamic(() => import("@/views/editor-view").then((m) => m.EditorView), { ssr: false, loading: Loading });
const SlidesView = dynamic(() => import("@/views/slides-view").then((m) => m.SlidesView), { ssr: false, loading: Loading });

function EmptyTab() {
  const { runCommand } = useWorkspace();
  const items = [
    { label: t("Crear nota"), cmd: "nota:nueva", keys: "Ctrl N" },
    { label: t("Ir a un archivo"), cmd: "selector:abrir", keys: "Ctrl O" },
    { label: t("Nota del día"), cmd: "diario:hoy", keys: "Alt D" },
    { label: t("Comandos"), cmd: "paleta:abrir", keys: "Ctrl P" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      {items.map((i) => (
        <button
          key={i.cmd}
          className="flex w-64 items-center justify-between rounded-md px-3 py-1.5 text-sm text-primary-soft hover:bg-surface-raised"
          onClick={() => runCommand(i.cmd)}
        >
          <span className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            {i.label}
          </span>
          <span className="text-xs text-faint">{i.keys}</span>
        </button>
      ))}
    </div>
  );
}

export function ViewHost({ view }: { view: ViewState }) {
  switch (view.type) {
    case "inicio":
      return <InicioView />;
    case "calendario":
      return <CalendarioView />;
    case "mails":
      return <MailsView />;
    case "repaso":
      return <RepasoView subjectId={view.subjectId} />;
    case "carreras":
      return <CarrerasView />;
    case "materia":
      return <MateriaView id={view.id} />;
    case "nota":
      return <NoteOrQuiz key={view.id} id={view.id} />;
    case "grafo":
      return <GrafoView noteId={view.noteId} />;
    case "canvas":
      return <CanvasView key={view.id} id={view.id} />;
    case "pdf":
      return <PdfView key={view.id} id={view.id} page={view.page} />;
    case "busqueda":
      return <BusquedaView query={view.query} />;
    case "web":
      return <WebView url={view.url} />;
    case "slides":
      return <SlidesView id={view.id} />;
    case "editor":
      return <EditorView key={view.id} id={view.id} />;
    case "base":
      return <BaseView />;
    case "ideas":
      return <IdeasView />;
    case "plantillas":
      return <PlantillasView />;
    case "notificaciones":
      return <NotificacionesView />;
    case "ajustes":
      return <AjustesView section={view.section} />;
    case "vacia":
      return <EmptyTab />;
  }
}
