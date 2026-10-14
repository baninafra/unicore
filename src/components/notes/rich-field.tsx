"use client";

// Campo de texto enriquecido (el mismo editor de las notas) para usar dentro de formularios:
// imágenes, listas con casillas, tablas, links, código… Se pega y se arrastra igual que en una nota.
// Escribí "/" para ver todo lo que se puede agregar.

import "@blocknote/mantine/style.css";
import "./editor.css";

import { useEffect } from "react";
import { es } from "@blocknote/core/locales";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useAppState } from "@/lib/app-state";
import { resolveFileUrl, saveFile } from "@/lib/db";

export function RichField({
  initial,
  placeholder,
  onChange,
}: {
  initial?: unknown[];
  placeholder?: string;
  onChange: (blocks: unknown[]) => void;
}) {
  const { theme } = useAppState();
  const editor = useCreateBlockNote({
    dictionary: { ...es, placeholders: { ...es.placeholders, emptyDocument: placeholder ?? es.placeholders.emptyDocument } },
    initialContent: initial?.length ? (initial as PartialBlock[]) : undefined,
    uploadFile: (file) => saveFile(file),
    resolveFileUrl: (url) => resolveFileUrl(url),
  });

  useEffect(() => editor.onChange((ed) => onChange(ed.document)), [editor, onChange]);

  return (
    <div className="unicore-editor uc-rich-field">
      <BlockNoteView editor={editor} theme={theme} />
    </div>
  );
}
