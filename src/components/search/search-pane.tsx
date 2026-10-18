"use client";

import { useEffect, useRef, useState } from "react";
import { CaseSensitive, ExternalLink } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { t } from "@/lib/i18n";
import { FOCUS_SEARCH_EVENT } from "@/lib/nav/palette-bus";
import { useSearch, type SortMode } from "@/lib/nav/search";
import { SearchResults, SortSelect, useOpenHit } from "./search-results";

// Búsqueda en la barra izquierda. Se enfoca sola al abrirse (Ctrl+Shift+F también la enfoca).
export function SearchPane() {
  const { openView } = useWorkspace();
  const [query, setQuery] = useState("");
  const [cs, setCs] = useState(false);
  const [sort, setSort] = useState<SortMode>("relevancia");
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useSearch(query, cs, sort);
  const openHit = useOpenHit();

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-0.5">
        <input
          ref={inputRef}
          className="input"
          placeholder={t("Buscar")}
          aria-label={t("Buscar")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={t("Distinguir mayúsculas")}
          aria-pressed={cs}
          title={t("Distinguir mayúsculas")}
          onClick={() => setCs((v) => !v)}
        >
          <CaseSensitive strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("Abrir en pestaña")}
          title={t("Abrir en pestaña")}
          onClick={() => openView({ type: "busqueda", query: query.trim() || undefined }, "tab")}
        >
          <ExternalLink strokeWidth={1.75} />
        </button>
      </div>
      <SortSelect value={sort} onChange={setSort} />
      <SearchResults hits={hits} query={query} onOpen={openHit} />
    </div>
  );
}
