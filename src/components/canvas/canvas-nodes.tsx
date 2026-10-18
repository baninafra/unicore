"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { BookOpen, File, FileText, Globe } from "lucide-react";
import { db, resolveFileUrl } from "@/lib/db";
import { t } from "@/lib/i18n";
import { useOpen } from "@/components/workspace/use-open";
import { MiniMarkdown } from "./mini-markdown";
import { cardColorStyle, type CanvasNode, type CanvasNodeData } from "./canvas-types";

// Acciones que el tablero le ofrece a las tarjetas (edición en línea y cambios de datos).
export interface CanvasActions {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
}

export const CanvasActionsCtx = createContext<CanvasActions>({
  editingId: null,
  setEditingId: () => {},
  patchNode: () => {},
});

const SIDES = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
];

// Cada tarjeta muestra sus 4 puntos de conexión; sólo se ven al pasar el mouse o al seleccionarla.
function Card({
  selected,
  data,
  children,
  minWidth = 120,
  minHeight = 60,
  className,
}: {
  selected: boolean;
  data: CanvasNodeData;
  children: ReactNode;
  minWidth?: number;
  minHeight?: number;
  className?: string;
}) {
  return (
    <div className={clsx("uc-card relative h-full w-full", className)} style={cardColorStyle(data.color)}>
      <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} lineClassName="uc-resize-line" handleClassName="uc-resize-handle" />
      {SIDES.map((s) => (
        <Handle key={s.id} id={s.id} type="source" position={s.position} className="uc-handle" />
      ))}
      {children}
    </div>
  );
}

// ---------- Texto ----------

export function TextoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { editingId, setEditingId, patchNode } = useContext(CanvasActionsCtx);
  const editing = editingId === id;
  return (
    <Card selected={selected} data={data} minWidth={120} minHeight={50}>
      {editing ? (
        <TextEditor
          initial={data.text ?? ""}
          onDone={(value) => {
            if (value !== undefined) patchNode(id, { text: value });
            setEditingId(null);
          }}
        />
      ) : (
        <div className="nowheel h-full overflow-y-auto p-3" onDoubleClick={() => setEditingId(id)}>
          {data.text?.trim() ? <MiniMarkdown text={data.text} /> : <span className="text-[length:calc(13px*var(--ui-scale,1))] text-faint">{t("Doble clic para editar")}</span>}
        </div>
      )}
    </Card>
  );
}

// Editor de texto de una tarjeta. Blur guarda; Esc descarta.
function TextEditor({ initial, onDone }: { initial: string; onDone: (value: string | undefined) => void }) {
  const skip = useRef(false);
  return (
    <textarea
      autoFocus
      defaultValue={initial}
      className="nodrag nowheel h-full w-full resize-none bg-transparent p-3 text-[length:calc(13px*var(--ui-scale,1))] leading-snug text-text outline-none"
      placeholder={t("Escribí en markdown: # títulos, - listas, **negrita**")}
      onBlur={(e) => onDone(skip.current ? undefined : e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          skip.current = true;
          onDone(undefined);
        }
      }}
    />
  );
}

// ---------- Nota ----------

export function NotaNode({ data, selected }: NodeProps<CanvasNode>) {
  const open = useOpen();
  // undefined = cargando, null = la nota ya no existe.
  const note = useLiveQuery(
    async () => (data.noteId ? ((await db.notes.get(data.noteId)) ?? null) : null),
    [data.noteId],
  );
  return (
    <Card selected={selected} data={data} minWidth={160} minHeight={70}>
      <div className="flex h-full flex-col gap-1.5 p-3" onDoubleClick={(e) => data.noteId && open({ type: "nota", id: data.noteId }, e)}>
        <div className="flex items-center gap-1.5 text-[length:calc(13px*var(--ui-scale,1))] font-medium">
          <FileText className="h-3.5 w-3.5 flex-none text-faint" strokeWidth={1.75} />
          <span className="truncate">
            {note ? note.title?.trim() || t("Sin título") : note === null ? t("Nota eliminada") : t("Cargando…")}
          </span>
        </div>
        {note?.plainTextCache && (
          <p className="line-clamp-6 whitespace-pre-line text-[length:calc(12px*var(--ui-scale,1))] leading-snug text-muted">{note.plainTextCache.slice(0, 600)}</p>
        )}
      </div>
    </Card>
  );
}

// ---------- Archivo / imagen ----------

export function ArchivoNode({ data, selected }: NodeProps<CanvasNode>) {
  const [url, setUrl] = useState("");
  const isImage = (data.mime ?? "").startsWith("image/");

  useEffect(() => {
    let alive = true;
    if (data.fileRef) void resolveFileUrl(data.fileRef).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [data.fileRef]);

  const ready = url.startsWith("blob:");
  return (
    <Card selected={selected} data={data} minWidth={100} minHeight={80}>
      <div className="h-full w-full" onDoubleClick={() => ready && window.open(url, "_blank")}>
        {isImage && ready ? (
          // Blob local de IndexedDB: next/image no optimiza estas URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={data.fileName ?? ""} className="h-full w-full select-none object-contain" draggable={false} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-muted">
            <File className="h-6 w-6 text-faint" strokeWidth={1.75} />
            <span className="max-w-full truncate text-[length:calc(13px*var(--ui-scale,1))]">{data.fileName || t("Archivo")}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- PDF ----------

export function PdfNode({ data, selected }: NodeProps<CanvasNode>) {
  const open = useOpen();
  return (
    <Card selected={selected} data={data} minWidth={160} minHeight={60}>
      <div className="flex h-full items-center gap-3 p-3" onDoubleClick={(e) => data.documentId && open({ type: "pdf", id: data.documentId }, e)}>
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-sm bg-rose-tint text-rose">
          <BookOpen className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[length:calc(13px*var(--ui-scale,1))] font-medium">{data.fileName || t("PDF")}</div>
          <div className="text-[length:calc(12px*var(--ui-scale,1))] text-faint">PDF</div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Web ----------

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function WebNode({ data, selected }: NodeProps<CanvasNode>) {
  const open = useOpen();
  const url = data.url ?? "";
  return (
    <Card selected={selected} data={data} minWidth={160} minHeight={60}>
      <div className="flex h-full items-center gap-3 p-3" onDoubleClick={(e) => url && open({ type: "web", url }, e)}>
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-sm bg-cyan-tint text-cyan">
          <Globe className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[length:calc(13px*var(--ui-scale,1))] font-medium">{data.title || hostOf(url) || t("Web")}</div>
          <div className="truncate text-[length:calc(12px*var(--ui-scale,1))] text-faint">{url}</div>
        </div>
      </div>
    </Card>
  );
}

// ---------- Grupo ----------

export function GrupoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { editingId, setEditingId, patchNode } = useContext(CanvasActionsCtx);
  const editing = editingId === id;
  const skip = useRef(false);
  return (
    <div className="uc-group relative h-full w-full rounded-[12px] border border-dashed border-border-strong">
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} lineClassName="uc-resize-line" handleClassName="uc-resize-handle" />
      <div className="absolute left-2 top-1.5 max-w-[calc(100%-16px)]">
        {editing ? (
          <input
            autoFocus
            defaultValue={data.name ?? t("Grupo")}
            className="nodrag input h-6 w-56 text-[length:calc(13px*var(--ui-scale,1))]"
            onBlur={(e) => {
              if (!skip.current) patchNode(id, { name: e.currentTarget.value.trim() || "Grupo" });
              skip.current = false;
              setEditingId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                skip.current = true;
                setEditingId(null);
              }
            }}
          />
        ) : (
          <span className="block cursor-text truncate text-[length:calc(13px*var(--ui-scale,1))] font-medium text-muted" onDoubleClick={() => setEditingId(id)}>
            {data.name || t("Grupo")}
          </span>
        )}
      </div>
    </div>
  );
}

export const canvasNodeTypes = {
  texto: TextoNode,
  nota: NotaNode,
  archivo: ArchivoNode,
  pdf: PdfNode,
  web: WebNode,
  grupo: GrupoNode,
};
