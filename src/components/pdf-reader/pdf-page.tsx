"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfHighlight } from "@/lib/types";
import "./pdf-reader.css";
import { HL_COLORS, loadPdfjs, type Pdfjs } from "./pdf-engine";

type TextLayerInstance = InstanceType<Pdfjs["TextLayer"]>;

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  root: HTMLElement | null; // contenedor con scroll (para saber qué páginas están cerca)
  highlights: PdfHighlight[];
  hitItems: number[]; // fragmentos de texto con coincidencias de búsqueda
  activeItem: number | null; // fragmento de la coincidencia actual
}

const FALLBACK = { w: 612, h: 792 };

// Una página del PDF: canvas + capa de texto seleccionable + resaltados.
// Se dibuja sólo cuando está cerca de la zona visible; al alejarse libera el canvas.
export function PdfPage({ doc, pageNumber, scale, root, highlights, hitItems, activeItem }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<PDFPageProxy | null>(null);
  const textLayerRef = useRef<TextLayerInstance | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(0);

  // Cerca de la zona visible (con margen generoso para que no aparezcan huecos al hacer scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: "1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Tamaño base de la página en puntos PDF.
  useEffect(() => {
    let alive = true;
    void doc.getPage(pageNumber).then((p) => {
      if (!alive) return;
      proxyRef.current = p;
      const v = p.getViewport({ scale: 1 });
      setBase({ w: v.width, h: v.height });
    });
    return () => {
      alive = false;
    };
  }, [doc, pageNumber]);

  // Dibujo: canvas (con resolución del monitor) y capa de texto.
  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return;

    if (!near) {
      // Fuera de la zona visible: liberamos la memoria del canvas.
      canvas.width = 0;
      canvas.height = 0;
      layer.replaceChildren();
      textLayerRef.current = null;
      return;
    }

    const page = proxyRef.current;
    if (!page) return;

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayer: TextLayerInstance | null = null;

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;
    layer.replaceChildren();

    const ctx = canvas.getContext("2d");
    if (ctx) {
      renderTask = page.render({
        canvasContext: ctx,
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask.promise.catch(() => {});
    }

    void (async () => {
      const pdfjs = await loadPdfjs();
      const content = await page.getTextContent();
      if (cancelled) return;
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
      textLayerRef.current = textLayer;
      await textLayer.render();
      if (!cancelled) setDrawn((d) => d + 1);
    })().catch(() => {});

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [near, scale, base]);

  // Marcas de búsqueda sobre los fragmentos de texto ya dibujados.
  useEffect(() => {
    const divs = textLayerRef.current?.textDivs ?? [];
    const hits = new Set(hitItems);
    divs.forEach((d, i) => {
      d.classList.toggle("uc-pdf-hit", hits.has(i));
      d.classList.toggle("uc-pdf-hit-active", i === activeItem);
    });
  }, [drawn, hitItems, activeItem]);

  // Al cambiar la coincidencia actual, la llevamos a la vista (una sola vez por cambio).
  useEffect(() => {
    if (activeItem === null) return;
    const key = `${activeItem}|${drawn}`;
    if (scrolledFor.current === key) return;
    const el = textLayerRef.current?.textDivs[activeItem];
    if (!el) return;
    scrolledFor.current = key;
    el.scrollIntoView({ block: "center" });
  }, [activeItem, drawn]);

  const dims = base ?? FALLBACK;
  return (
    <div
      ref={wrapRef}
      data-uc-page={pageNumber}
      className="relative bg-white ring-1 ring-black/10"
      style={{ width: dims.w * scale, height: dims.h * scale }}
    >
      <canvas ref={canvasRef} className="absolute left-0 top-0 block" />
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {highlights.flatMap((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className="absolute"
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                background: HL_COLORS[h.color].bg,
              }}
            />
          )),
        )}
      </div>
      <div ref={layerRef} className="uc-pdf-textlayer" />
    </div>
  );
}
