"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { PdfHighlight } from "@/lib/types";
import { PdfPage } from "@/components/pdf-reader/pdf-page";
import { PdfToolbar } from "@/components/pdf-reader/pdf-toolbar";
import { PdfSelectionMenu } from "@/components/pdf-reader/pdf-selection-menu";
import { PdfHighlightsPanel } from "@/components/pdf-reader/pdf-highlights-panel";
import {
  addHighlights,
  captureSelection,
  deleteHighlight,
  findInPdf,
  openPdfFile,
  updateHighlight,
  type OpenedPdf,
  type SearchHit,
  type SelectionPiece,
} from "@/components/pdf-reader/pdf-engine";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const PAGE_GUTTER = 48; // margen horizontal al ajustar al ancho
const NO_HL: PdfHighlight[] = [];
const NO_HITS: number[] = [];

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

interface Menu {
  x: number;
  y: number;
  below: boolean;
  pieces: SelectionPiece[];
}

// Lector de PDF con resaltado (estilo Logseq): páginas con capa de texto, búsqueda, resaltados y panel.
export function PdfView({ id, page }: { id: string; page?: number }) {
  // undefined mientras carga; null si el documento no existe.
  const record = useLiveQuery(async () => (await db.documents.get(id)) ?? null, [id], undefined);
  const fileId = record?.fileId ?? null;

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [openState, setOpenState] = useState<"abriendo" | "listo" | "sin-archivo" | "error">("abriendo");

  // ----- carga del PDF original -----
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    let opened: OpenedPdf | null = null;
    openPdfFile(fileId)
      .then((o) => {
        if (!alive) {
          void o?.destroy();
          return;
        }
        opened = o;
        if (!o) setOpenState("sin-archivo");
        else {
          setPdf(o.doc);
          setOpenState("listo");
        }
      })
      .catch(() => alive && setOpenState("error"));
    return () => {
      alive = false;
      void opened?.destroy();
      setPdf(null);
      setOpenState("abriendo");
    };
  }, [fileId]);

  // ----- páginas, zoom y página actual -----
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const setScrollerRef = useCallback((el: HTMLDivElement | null) => setScroller(el), []);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [current, setCurrent] = useState(1);
  const [panelOpen, setPanelOpen] = useState(true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const anchorRef = useRef<{ page: number; frac: number } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    void pdf.getPage(1).then((p) => {
      if (alive) setPageWidth(p.getViewport({ scale: 1 }).width);
    });
    return () => {
      alive = false;
    };
  }, [pdf]);

  // Modo "ajustar al ancho": se recalcula al cambiar el tamaño del panel o de la ventana.
  useEffect(() => {
    if (!scroller || !pageWidth) return;
    const apply = () => {
      if (fitMode) setScale(clampScale((scroller.clientWidth - PAGE_GUTTER) / pageWidth));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller, pageWidth, fitMode]);

  // Antes de cambiar el zoom guardamos qué parte de qué página se ve, para no saltar de lugar.
  const captureAnchor = useCallback(() => {
    if (!scroller) return null;
    const pe = scroller.querySelector<HTMLElement>(`[data-uc-page="${current}"]`);
    if (!pe) return null;
    const rect = pe.getBoundingClientRect();
    const viewTop = scroller.getBoundingClientRect().top;
    return { page: current, frac: rect.height ? (viewTop - rect.top) / rect.height : 0 };
  }, [scroller, current]);

  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!scroller || !a) return;
    anchorRef.current = null;
    const pe = scroller.querySelector<HTMLElement>(`[data-uc-page="${a.page}"]`);
    if (!pe) return;
    const rect = pe.getBoundingClientRect();
    const viewTop = scroller.getBoundingClientRect().top;
    scroller.scrollTop += rect.top + a.frac * rect.height - viewTop;
  }, [scale, scroller]);

  const zoom = (action: "in" | "out" | "fit") => {
    if (action === "fit") {
      setFitMode(true);
      return;
    }
    anchorRef.current = captureAnchor();
    setFitMode(false);
    setScale((s) => clampScale(action === "in" ? s * 1.2 : s / 1.2));
  };

  const goTo = useCallback(
    (n: number) => {
      if (!scroller) return;
      const pe = scroller.querySelector<HTMLElement>(`[data-uc-page="${n}"]`);
      if (!pe) return;
      scroller.scrollTop += pe.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      setCurrent(n);
    },
    [scroller],
  );

  // Abre en la página pedida (al entrar, o cuando la vista cambia de página).
  useEffect(() => {
    if (!pdf || !scroller || !page) return;
    const timer = window.setTimeout(() => goTo(Math.min(page, pdf.numPages)), 60);
    return () => window.clearTimeout(timer);
  }, [pdf, scroller, page, goTo]);

  const onScroll = () => {
    setMenu(null);
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (!scroller) return;
      const probe = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.25;
      let best = 1;
      scroller.querySelectorAll<HTMLElement>("[data-uc-page]").forEach((p) => {
        if (p.getBoundingClientRect().top <= probe) best = Number(p.dataset.ucPage);
      });
      setCurrent(best);
    });
  };

  // ----- búsqueda -----
  const itemsCache = useRef(new Map<number, string[]>());
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const searchToken = useRef(0);

  useEffect(() => {
    itemsCache.current = new Map();
    setHits([]);
    setSearchedQuery(null);
  }, [pdf]);

  const jumpTo = (index: number, list: SearchHit[]) => {
    const hit = list[index];
    if (!hit) return;
    setHitIndex(index);
    goTo(hit.page);
  };

  const runSearch = async (q: string) => {
    if (!pdf) return;
    const token = ++searchToken.current;
    setSearching(true);
    const found = await findInPdf(pdf, q, itemsCache.current);
    if (token !== searchToken.current) return;
    setHits(found);
    setSearchedQuery(q);
    setSearching(false);
    setHitIndex(0);
    if (found.length) jumpTo(0, found);
  };

  const onQuery = (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      searchToken.current++;
      setHits([]);
      setSearchedQuery(null);
      setSearching(false);
      setHitIndex(0);
    }
  };

  const onSearch = (step: "first" | "next" | "prev") => {
    const q = query.trim();
    if (!q) return;
    if (q !== searchedQuery) {
      void runSearch(q);
      return;
    }
    if (!hits.length) return;
    const n = hits.length;
    const next = step === "prev" ? (hitIndex - 1 + n) % n : (hitIndex + 1) % n;
    jumpTo(next, hits);
  };

  const hitItems = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const h of hits) map.set(h.page, [...(map.get(h.page) ?? []), h.item]);
    return map;
  }, [hits]);
  const activeHit = hits[hitIndex];

  // ----- resaltados guardados -----
  const highlights = record?.highlights ?? NO_HL;
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, PdfHighlight[]>();
    for (const h of highlights) map.set(h.page, [...(map.get(h.page) ?? []), h]);
    return map;
  }, [highlights]);

  // ----- selección de texto -----
  const checkSelection = () => {
    const sel = window.getSelection();
    if (!scroller || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setMenu(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!scroller.contains(range.commonAncestorContainer)) {
      setMenu(null);
      return;
    }
    const pieces = captureSelection(range, scroller);
    if (!pieces.length) {
      setMenu(null);
      return;
    }
    const r = range.getBoundingClientRect();
    const below = r.top < 90;
    setMenu({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below, pieces });
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setMenu(null);
  };

  const onColor = (color: PdfHighlight["color"]) => {
    if (!menu) return;
    void addHighlights(id, menu.pieces, color);
    clearSelection();
  };

  const onCopy = () => {
    if (!menu || !record) return;
    const blocks: unknown[] = [];
    for (const p of menu.pieces) {
      // BlockNote tiene el bloque "quote" en su esquema por defecto.
      blocks.push({ type: "quote", content: p.text });
      blocks.push({ type: "paragraph", content: t("— {name}, pág. {page}", { name: record.fileName, page: p.page }) });
    }
    window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail: { blocks } }));
    const plain = menu.pieces.map((p) => `"${p.text}" (${t("{name}, pág. {page}", { name: record.fileName, page: p.page })})`).join("\n");
    void navigator.clipboard?.writeText(plain).catch(() => {});
    clearSelection();
  };

  const onNote = () => {
    if (!menu) return;
    const pieces = menu.pieces;
    clearSelection();
    void addHighlights(id, pieces, "amarillo").then((created) => {
      setPanelOpen(true);
      setEditId(created[0]?.id ?? null);
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----- render -----
  if (record === undefined) return null;
  if (record === null) return <Message>{t("No encontramos este PDF.")}</Message>;
  if (!record.fileId || openState === "sin-archivo") return <Message>{t("No encontramos el archivo de este PDF.")}</Message>;
  if (openState === "error") return <Message>{t("No pudimos abrir este PDF. Probá de nuevo.")}</Message>;
  if (!pdf) return <Message>{t("Abriendo PDF…")}</Message>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PdfToolbar
        page={current}
        pages={pdf.numPages}
        onGoTo={goTo}
        scale={scale}
        onZoom={zoom}
        query={query}
        onQuery={onQuery}
        onSearch={onSearch}
        hitCount={hits.length}
        hitIndex={hitIndex}
        searching={searching}
        searched={searchedQuery !== null && searchedQuery === query.trim()}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((o) => !o)}
      />

      <div className="flex min-h-0 flex-1">
        <div
          ref={setScrollerRef}
          className="relative min-w-0 flex-1 overflow-auto bg-surface"
          onScroll={onScroll}
          onMouseDown={() => setMenu(null)}
          onMouseUp={() => window.setTimeout(checkSelection, 0)}
          onKeyUp={(e) => e.shiftKey && window.setTimeout(checkSelection, 0)}
        >
          <div className="relative mx-auto flex w-max min-w-full flex-col items-center gap-4 py-4">
            {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((n) => (
              <PdfPage
                key={n}
                doc={pdf}
                pageNumber={n}
                scale={scale}
                root={scroller}
                highlights={highlightsByPage.get(n) ?? NO_HL}
                hitItems={hitItems.get(n) ?? NO_HITS}
                activeItem={activeHit && activeHit.page === n ? activeHit.item : null}
              />
            ))}
          </div>
        </div>

        {panelOpen && (
          <aside className="w-[240px] flex-none overflow-y-auto border-l border-border bg-bg">
            <PdfHighlightsPanel
              highlights={highlights}
              onGoTo={goTo}
              onNote={(hid, note) => void updateHighlight(id, hid, { note: note || undefined })}
              onDelete={(hid) => void deleteHighlight(id, hid)}
              editId={editId}
              onEditDone={() => setEditId(null)}
            />
          </aside>
        )}
      </div>

      {menu && (
        <PdfSelectionMenu x={menu.x} y={menu.y} below={menu.below} onColor={onColor} onCopy={onCopy} onNote={onNote} />
      )}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div className="p-4 t-small text-faint">{children}</div>;
}
