"use client";

import { useState, type DragEvent } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, FileText, NotebookPen, Search, Shapes, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { type Bookmark, type BookmarkKind } from "@/lib/types";
import { viewForBookmark, runSafe } from "@/lib/nav/actions";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu } from "@/components/ui/menu";
import { PromptModal } from "@/components/ui/prompt-modal";

const KIND_ICON: Record<BookmarkKind, LucideIcon> = {
  note: NotebookPen,
  subject: BookOpen,
  canvas: Shapes,
  search: Search,
  document: FileText,
};

// Marcadores: clic abre (Ctrl+clic pestaña nueva), arrastrar para ordenar, clic derecho para renombrar o quitar.
export function BookmarksPane() {
  const items = useLiveQuery(() => db.bookmarks.orderBy("order").toArray(), []);
  const open = useOpen();
  const menu = useContextMenu();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Bookmark | null>(null);

  const reorder = (fromId: string, toId: string) => {
    if (!items || fromId === toId) return;
    const from = items.findIndex((b) => b.id === fromId);
    const to = items.findIndex((b) => b.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    runSafe(() => db.bookmarks.bulkPut(next.map((b, i) => ({ ...b, order: i + 1 }))));
  };

  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  if (items === undefined) return null;
  if (!items.length) return <p className="px-3 py-3 text-[length:calc(13px*var(--ui-scale,1))] text-faint">Sin marcadores</p>;

  return (
    <div className="flex flex-col gap-px p-1">
      {items.map((b) => {
        const Icon = KIND_ICON[b.kind];
        return (
          <button
            key={b.id}
            type="button"
            draggable
            className={clsx(
              "row w-full text-left",
              overId === b.id && dragId !== b.id && "bg-primary-tint text-text",
              dragId === b.id && "opacity-50",
            )}
            onClick={(e) => open(viewForBookmark(b.kind, b.targetId), e)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                open(viewForBookmark(b.kind, b.targetId), { button: 1 });
              }
            }}
            onContextMenu={(e) =>
              menu.open(e, [
                { label: "Renombrar", onSelect: () => setRenaming(b) },
                { label: "Quitar", danger: true, onSelect: () => runSafe(() => db.bookmarks.delete(b.id)) },
              ])
            }
            onDragStart={(e: DragEvent<HTMLButtonElement>) => {
              setDragId(b.id);
              e.dataTransfer.setData("text/plain", b.title);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e: DragEvent<HTMLButtonElement>) => {
              if (!dragId) return;
              e.preventDefault();
              if (overId !== b.id) setOverId(b.id);
            }}
            onDrop={(e: DragEvent<HTMLButtonElement>) => {
              e.preventDefault();
              if (dragId) reorder(dragId, b.id);
              endDrag();
            }}
            onDragEnd={endDrag}
          >
            <Icon strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
          </button>
        );
      })}
      <PromptModal
        open={renaming !== null}
        title="Renombrar marcador"
        initial={renaming?.title ?? ""}
        confirmLabel="Renombrar"
        onConfirm={(value) => {
          if (renaming) runSafe(() => db.bookmarks.update(renaming.id, { title: value }));
        }}
        onClose={() => setRenaming(null)}
      />
      {menu.menu}
    </div>
  );
}
