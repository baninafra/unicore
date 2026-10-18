"use client";

import { useState, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import clsx from "clsx";
import { ChevronDown, ChevronUp, Maximize2, PanelRight, PanelRightClose, ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  page: number;
  pages: number;
  onGoTo: (n: number) => void;
  scale: number;
  onZoom: (action: "in" | "out" | "fit") => void;
  query: string;
  onQuery: (q: string) => void;
  onSearch: (step: "first" | "next" | "prev") => void;
  hitCount: number;
  hitIndex: number;
  searching: boolean;
  searched: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

// Barra fina del lector: página, zoom, búsqueda y panel de resaltados.
export function PdfToolbar({
  page,
  pages,
  onGoTo,
  scale,
  onZoom,
  query,
  onQuery,
  onSearch,
  hitCount,
  hitIndex,
  searching,
  searched,
  panelOpen,
  onTogglePanel,
}: Props) {
  const [pageDraft, setPageDraft] = useState<string | null>(null);

  const commitPage = () => {
    if (pageDraft === null) return;
    const n = Math.round(Number(pageDraft));
    setPageDraft(null);
    if (Number.isFinite(n) && n >= 1 && n <= pages) onGoTo(n);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch(e.shiftKey ? "prev" : "first");
    }
    if (e.key === "Escape") onQuery("");
  };

  return (
    <div className="flex h-9 flex-none items-center gap-2 border-b border-border bg-bg px-2 text-[length:calc(13px*var(--ui-scale,1))]">
      <div className="flex items-center gap-1 text-muted">
        <input
          className="input num h-6 w-14 px-1 text-center text-[length:calc(13px*var(--ui-scale,1))]"
          value={pageDraft ?? String(page)}
          onChange={(e) => setPageDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setPageDraft(null);
          }}
          aria-label={t("Página")}
          inputMode="numeric"
        />
        <span className="num text-faint">/ {pages}</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
        <input
          className="input h-6 w-full max-w-[260px] text-[length:calc(13px*var(--ui-scale,1))]"
          placeholder={t("Buscar en el PDF")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onSearchKey}
          aria-label={t("Buscar en el PDF")}
        />
        {query.trim() && (
          <>
            <span className="num min-w-[56px] text-center text-[length:calc(12px*var(--ui-scale,1))] text-faint">
              {searching ? t("Buscando…") : hitCount > 0 ? t("{n} de {total}", { n: hitIndex + 1, total: hitCount }) : searched ? t("Sin resultados") : ""}
            </span>
            <button type="button" className="icon-btn h-6 w-6" onClick={() => onSearch("prev")} disabled={hitCount === 0} aria-label={t("Coincidencia anterior")}>
              <ChevronUp strokeWidth={1.75} />
            </button>
            <button type="button" className="icon-btn h-6 w-6" onClick={() => onSearch("next")} disabled={hitCount === 0} aria-label={t("Coincidencia siguiente")}>
              <ChevronDown strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button type="button" className="icon-btn h-6 w-6" onClick={() => onZoom("out")} aria-label={t("Alejar")}>
          <ZoomOut strokeWidth={1.75} />
        </button>
        <span className="num w-11 text-center text-[length:calc(12px*var(--ui-scale,1))] text-muted">{Math.round(scale * 100)}%</span>
        <button type="button" className="icon-btn h-6 w-6" onClick={() => onZoom("in")} aria-label={t("Acercar")}>
          <ZoomIn strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn h-6 w-6" onClick={() => onZoom("fit")} aria-label={t("Ajustar al ancho")} title={t("Ajustar al ancho")}>
          <Maximize2 strokeWidth={1.75} />
        </button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          className={clsx("icon-btn h-6 w-6", panelOpen && "text-primary-soft")}
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          aria-label={t("Resaltados")}
          title={t("Resaltados")}
        >
          {panelOpen ? <PanelRightClose strokeWidth={1.75} /> : <PanelRight strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}
