"use client";

import { useEffect, useState } from "react";
import { CaseSensitive } from "lucide-react";
import { useSearch, type SortMode } from "@/lib/nav/search";
import { SearchResults, SortSelect, useOpenHit } from "@/components/search/search-results";

// Búsqueda en pestaña. Recibe la consulta inicial (por ejemplo desde un marcador).
export function BusquedaView({ query = "" }: { query?: string }) {
  const [value, setValue] = useState(query);
  const [cs, setCs] = useState(false);
  const [sort, setSort] = useState<SortMode>("relevancia");
  const hits = useSearch(value, cs, sort);
  const openHit = useOpenHit();

  useEffect(() => {
    setValue(query);
  }, [query]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <input
          className="input"
          autoFocus
          placeholder="Buscar"
          aria-label="Buscar"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Distinguir mayúsculas"
          aria-pressed={cs}
          title="Distinguir mayúsculas"
          onClick={() => setCs((v) => !v)}
        >
          <CaseSensitive strokeWidth={1.75} />
        </button>
        <div className="w-44 flex-none">
          <SortSelect value={sort} onChange={setSort} />
        </div>
      </div>
      <SearchResults hits={hits} query={value} onOpen={openHit} />
    </div>
  );
}
