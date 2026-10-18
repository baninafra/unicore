"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";

export interface PickItem {
  id: string;
  label: string;
  group?: string;
  hint?: string;
}

// Selector con buscador: sirve para elegir una nota (combinar) o un destino (mover).
export function ListPicker({
  open,
  title,
  placeholder,
  items,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  items: PickItem[];
  onPick: (item: PickItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => !q || i.label.toLowerCase().includes(q) || (i.group ?? "").toLowerCase().includes(q));
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, PickItem[]>();
    for (const i of shown) map.set(i.group ?? "", [...(map.get(i.group ?? "") ?? []), i]);
    return [...map.entries()];
  }, [shown]);

  const pick = (item: PickItem) => {
    setQuery("");
    onPick(item);
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width={480}>
      <input
        autoFocus
        className="input mb-3"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) pick(shown[0]);
        }}
      />
      {!shown.length && <p className="t-small text-faint">Sin resultados</p>}
      <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto">
        {groups.map(([group, list]) => (
          <div key={group || "_"} className="flex flex-col gap-0.5">
            {group && <div className="section-label pb-1">{group}</div>}
            {list.map((item) => (
              <button key={item.id} type="button" className="row w-full justify-between text-left" onClick={() => pick(item)}>
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[length:calc(11px*var(--ui-scale,1))] text-faint">{item.hint}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
