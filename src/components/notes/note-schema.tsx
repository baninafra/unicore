"use client";

import type { CSSProperties } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, insertOrUpdateBlockForSlashMenu, type BlockNoteEditor } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec, getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from "@blocknote/react";
import { Info, Lightbulb, NotebookPen, Quote, Star, TriangleAlert, CircleHelp, Heading2, MonitorPlay } from "lucide-react";
import { WikilinkChip } from "./wikilink";
import { VideoEmbedView } from "./video-embed";

// Tipos de callout (como los admoniciones de Obsidian). Cada uno tiene ícono y color suave.
export const CALLOUT_TIPOS = ["nota", "info", "aviso", "importante", "pregunta", "cita"] as const;
export type CalloutTipo = (typeof CALLOUT_TIPOS)[number];

const CALLOUT_META: Record<CalloutTipo, { label: string; icon: typeof Info; color: string }> = {
  nota: { label: "Nota", icon: NotebookPen, color: "var(--primary-soft)" },
  info: { label: "Información", icon: Info, color: "var(--cyan)" },
  aviso: { label: "Aviso", icon: TriangleAlert, color: "var(--amber)" },
  importante: { label: "Importante", icon: Star, color: "var(--rose)" },
  pregunta: { label: "Pregunta", icon: CircleHelp, color: "var(--mint)" },
  cita: { label: "Cita", icon: Quote, color: "var(--text-muted)" },
};

interface CalloutBlockShape {
  id: string;
  props: { tipo: CalloutTipo };
}

interface CalloutEditorShape {
  updateBlock: (block: { id: string }, update: { props: { tipo: CalloutTipo } }) => void;
}

function CalloutView({
  block,
  editor,
  contentRef,
}: {
  block: CalloutBlockShape;
  editor: CalloutEditorShape;
  contentRef: (node: HTMLElement | null) => void;
}) {
  const tipo = CALLOUT_TIPOS.includes(block.props.tipo) ? block.props.tipo : "nota";
  const meta = CALLOUT_META[tipo];
  const Icon = meta.icon;
  const next = () => {
    const i = CALLOUT_TIPOS.indexOf(tipo);
    editor.updateBlock(block, { props: { tipo: CALLOUT_TIPOS[(i + 1) % CALLOUT_TIPOS.length] } });
  };
  return (
    <div className="callout" data-tipo={tipo} style={{ "--callout": meta.color } as CSSProperties}>
      <button
        type="button"
        className="callout-icon"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={next}
        aria-label={`Tipo de bloque: ${meta.label}`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <div className="callout-body" ref={contentRef} />
    </div>
  );
}

const CalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { tipo: { default: "nota", values: CALLOUT_TIPOS } },
    content: "inline",
  },
  {
    render: (props) => (
      <CalloutView
        block={props.block as unknown as CalloutBlockShape}
        editor={props.editor as unknown as CalloutEditorShape}
        contentRef={props.contentRef}
      />
    ),
  },
);

// Enlace interno [[nota]]: contenido inline sin texto editable, guarda el id de la nota.
const WikilinkInline = createReactInlineContentSpec(
  {
    type: "wikilink",
    propSchema: {
      noteId: { default: "" },
      title: { default: "" },
      alias: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => (
      <WikilinkChip
        noteId={props.inlineContent.props.noteId}
        title={props.inlineContent.props.title}
        alias={props.inlineContent.props.alias}
      />
    ),
  },
);

// Video de YouTube o Vimeo embebido (se crea al pegar el link o desde el menú "/").
const VideoEmbedBlock = createReactBlockSpec(
  {
    type: "videoEmbed",
    propSchema: { url: { default: "" } },
    content: "none",
  },
  {
    render: (props) => (
      <VideoEmbedView
        url={props.block.props.url}
        editable={props.editor.isEditable}
        onUrl={(url) => props.editor.updateBlock(props.block, { props: { url } })}
      />
    ),
  },
);

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: CalloutBlock(), videoEmbed: VideoEmbedBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, wikilink: WikilinkInline },
});

export type NoteBlockEditor = BlockNoteEditor<
  typeof noteSchema.blockSchema,
  typeof noteSchema.inlineContentSchema,
  typeof noteSchema.styleSchema
>;

// Comandos del menú "/": los de BlockNote en español más los propios.
export function slashMenuItems(editor: NoteBlockEditor): DefaultReactSuggestionItem[] {
  return [
    ...getDefaultReactSlashMenuItems(editor),
    {
      title: "Callout",
      aliases: ["nota", "info", "aviso", "importante", "pregunta", "cita", "alerta", "destacado"],
      subtext: "Bloque destacado con ícono",
      icon: <Lightbulb className="h-4 w-4" strokeWidth={1.75} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "callout" });
      },
    },
    {
      title: "Video (YouTube, Drive)",
      aliases: ["youtube", "vimeo", "drive", "video", "embed", "link"],
      subtext: "Pegá el link y se ve en la nota",
      icon: <MonitorPlay className="h-4 w-4" strokeWidth={1.75} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "videoEmbed" });
      },
    },
    {
      title: "Título plegable",
      aliases: ["toggle", "desplegable", "plegable", "colapsable"],
      subtext: "Se pliega y despliega",
      icon: <Heading2 className="h-4 w-4" strokeWidth={1.75} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: "heading", props: { level: 2, isToggleable: true } });
      },
    },
  ];
}
