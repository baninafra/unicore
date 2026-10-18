"use client";

import { useMemo } from "react";
import { useContextMenu } from "@/components/ui/menu";
import { useOpen } from "@/components/workspace/use-open";
import { useWorkspace } from "@/lib/workspace";
import { queueBaseFilter } from "@/lib/panes/base-query";
import { useAllNotes } from "@/lib/panes/hooks";
import { summarizeProps } from "@/lib/panes/props";
import { PaneEmpty } from "./pane-ui";
import { t } from "@/lib/i18n";

// Propiedades usadas en todas las notas. Clic: abre la base filtrada por esa propiedad.
export function PropertiesPane() {
  const notes = useAllNotes();
  const props = useMemo(() => summarizeProps(notes), [notes]);
  const { openView } = useWorkspace();
  const open = useOpen();
  const ctx = useContextMenu();

  const showInBase = (key: string, mode?: "tab") => {
    queueBaseFilter({ field: key, op: "existe", value: "" });
    openView({ type: "base" }, mode);
  };

  return (
    <div className="p-2">
      {props.length === 0 && <PaneEmpty>{t("Sin propiedades")}</PaneEmpty>}
      {props.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={(e) => {
            queueBaseFilter({ field: p.key, op: "existe", value: "" });
            open({ type: "base" }, e);
          }}
          onContextMenu={(e) =>
            ctx.open(e, [
              { label: t("Filtrar en la base"), onSelect: () => showInBase(p.key) },
              { label: t("Filtrar en pestaña nueva"), onSelect: () => showInBase(p.key, "tab") },
            ])
          }
          className="row w-full min-w-0"
        >
          <span className="min-w-0 flex-1 truncate text-left text-[length:calc(13px*var(--ui-scale,1))] text-text">{p.key}</span>
          <span className="text-[length:calc(12px*var(--ui-scale,1))] text-faint">{p.kind}</span>
          <span className="num w-6 text-right text-[length:calc(12px*var(--ui-scale,1))] text-faint">{p.count}</span>
        </button>
      ))}
      {ctx.menu}
    </div>
  );
}
