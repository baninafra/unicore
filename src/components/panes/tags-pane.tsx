"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useOpen } from "@/components/workspace/use-open";
import { useAllNotes } from "@/lib/panes/hooks";
import { buildTagTree, sortNodes, type TagNode } from "@/lib/panes/tag-tree";
import { PaneEmpty } from "./pane-ui";

type SortMode = "nombre" | "frecuencia";

// Etiquetas de todas las notas, como árbol. Clic: busca las notas con esa etiqueta.
export function TagsPane() {
  const notes = useAllNotes();
  const roots = useMemo(() => buildTagTree(notes), [notes]);
  const [sort, setSort] = useState<SortMode>("nombre");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="p-2">
      <div className="mb-1 flex items-center gap-3 px-2">
        {(["nombre", "frecuencia"] as SortMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={sort === mode}
            onClick={() => setSort(mode)}
            className={clsx("text-[12px] capitalize", sort === mode ? "text-text" : "text-faint hover:text-text")}
          >
            {mode === "nombre" ? "Nombre" : "Frecuencia"}
          </button>
        ))}
      </div>
      {roots.length === 0 ? (
        <PaneEmpty>Sin etiquetas</PaneEmpty>
      ) : (
        sortNodes(roots, sort).map((node) => (
          <TagBranch key={node.path} node={node} depth={0} sort={sort} collapsed={collapsed} toggle={toggle} />
        ))
      )}
    </div>
  );
}

function TagBranch({
  node,
  depth,
  sort,
  collapsed,
  toggle,
}: {
  node: TagNode;
  depth: number;
  sort: SortMode;
  collapsed: Set<string>;
  toggle: (path: string) => void;
}) {
  const open = useOpen();
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.path);

  return (
    <>
      <div className="row" style={{ paddingLeft: 4 + depth * 12 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={isCollapsed ? "Desplegar" : "Plegar"}
            onClick={() => toggle(node.path)}
            className="icon-btn h-5 w-5 flex-none"
          >
            <ChevronRight className={clsx("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")} strokeWidth={1.75} />
          </button>
        ) : (
          <span className="h-5 w-5 flex-none" />
        )}
        <button
          type="button"
          title={`#${node.path}`}
          onClick={(e) => open({ type: "busqueda", query: `tag:#${node.path}` }, e)}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-text hover:text-primary-soft"
        >
          <span className="text-faint">#</span>
          {node.name}
        </button>
        <span className="num text-[12px] text-faint">{node.total}</span>
      </div>
      {hasChildren &&
        !isCollapsed &&
        sortNodes(node.children, sort).map((child) => (
          <TagBranch key={child.path} node={child} depth={depth + 1} sort={sort} collapsed={collapsed} toggle={toggle} />
        ))}
    </>
  );
}
