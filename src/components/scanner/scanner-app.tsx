"use client";

// Escáner de documentos a pantalla completa (se abre desde Herramientas o con la paleta de comandos).
// Sacás fotos con la cámara o las subís, la app encuentra la hoja, la endereza y la limpia; podés
// corregir las esquinas, cambiar el filtro, rotar y ordenar las páginas. Después reconoce el texto
// (OCR) y lo guarda como PDF buscable, en la bibliografía de una materia o como nota.

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Crop,
  Download,
  FilePlus,
  FileText,
  ImagePlus,
  Loader2,
  RotateCcw,
  RotateCw,
  ScanLine,
  ScanText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { db, newId, nowIso, saveFile } from "@/lib/db";
import {
  buildPdf,
  defaultCorners,
  detectCorners,
  FILTER_LABEL,
  guessTitle,
  loadBitmap,
  normalizeSource,
  recognize,
  renderPage,
  stopOcr,
  warmUpScanner,
  type OcrResult,
  type PageSize,
  type Pt,
  type ScanFilter,
} from "@/lib/scanner/scanner";
import { createOfficeDoc } from "@/lib/editors/editors";
import { createNote } from "@/components/notes/note-utils";
import { markdownToBlocks } from "@/lib/notes/md-blocks";
import { isSpecialFolder } from "@/lib/nav/actions";
import { pickFolder } from "@/components/shell/folder-picker";
import { useWorkspace } from "@/lib/workspace";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { saveBlob, safeFileName } from "@/lib/export/save";
import { toast } from "@/lib/undo";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { CornerEditor } from "./corner-editor";
import { ScannerCamera } from "./camera";

const EVENT = "uc:scanner";

export function openScanner(mode: "camera" | "files" = "camera") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { mode } }));
}

interface Page {
  id: string;
  source: Blob; // foto original (achicada)
  sourceUrl: string;
  sw: number;
  sh: number;
  corners: Pt[];
  filter: ScanFilter;
  rotation: number;
  result?: { blob: Blob; url: string; width: number; height: number };
  busy: boolean;
  ocr?: OcrResult;
  ocrBusy?: boolean;
  error?: string;
}

const FILTERS: ScanFilter[] = ["mejorado", "color", "gris", "byn"];
const LS_FILTER = "uc-scan-filter";

function readFilter(): ScanFilter {
  try {
    const v = localStorage.getItem(LS_FILTER) as ScanFilter | null;
    if (v && FILTERS.includes(v)) return v;
  } catch {}
  return "mejorado";
}

function pickImages(onPick: (files: File[]) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.onchange = () => input.files?.length && onPick([...input.files]);
  input.click();
}

export function ScannerApp() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"camera" | "pages" | "edit">("pages");
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ corners: Pt[]; filter: ScanFilter; rotation: number } | null>(null);
  const [text, setText] = useState("");
  const [textEdited, setTextEdited] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<PageSize>("original");
  const [working, setWorking] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;
  const { openView } = useWorkspace();
  const ai = useLocalAI();
  const { open: openMenu, menu } = useContextMenu();

  const patch = useCallback((id: string, p: Partial<Page>) => setPages((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x))), []);

  const process = useCallback(
    async (page: Page, corners: Pt[], filter: ScanFilter, rotation: number) => {
      patch(page.id, { busy: true, error: undefined, corners, filter, rotation });
      try {
        const r = await renderPage(page.source, corners, filter, rotation);
        setPages((list) =>
          list.map((x) => {
            if (x.id !== page.id) return x;
            if (x.result) URL.revokeObjectURL(x.result.url);
            // Si cambió la imagen, el texto reconocido ya no sirve.
            return { ...x, busy: false, ocr: undefined, result: { ...r, url: URL.createObjectURL(r.blob) } };
          }),
        );
      } catch (e) {
        patch(page.id, { busy: false, error: e instanceof Error ? e.message : "No pudimos procesar la foto." });
      }
    },
    [patch],
  );

  // Agrega fotos: las achica, busca la hoja y la procesa.
  const addPhotos = useCallback(
    async (blobs: { blob: Blob; corners?: Pt[] | null; scale?: number }[]) => {
      const filter = readFilter();
      for (const item of blobs) {
        try {
          const norm = await normalizeSource(item.blob);
          let corners: Pt[] | null = null;
          if (item.corners) {
            // Las esquinas vienen en píxeles de la foto original: se pasan a la achicada.
            const bmp = await loadBitmap(item.blob);
            const k = norm.width / bmp.width;
            bmp.close();
            corners = item.corners.map((p) => ({ x: p.x * k, y: p.y * k }));
          } else {
            const bmp = await loadBitmap(norm.blob);
            corners = await detectCorners(bmp, bmp.width, bmp.height).catch(() => null);
            bmp.close();
          }
          const page: Page = {
            id: newId(),
            source: norm.blob,
            sourceUrl: URL.createObjectURL(norm.blob),
            sw: norm.width,
            sh: norm.height,
            corners: corners ?? defaultCorners(norm.width, norm.height, 0),
            filter,
            rotation: 0,
            busy: true,
          };
          setPages((list) => [...list, page]);
          void process(page, page.corners, filter, 0);
        } catch {
          toast("No pudimos abrir una de las imágenes.", { tone: "error" });
        }
      }
    },
    [process],
  );

  const onCapture = useCallback((blob: Blob, corners: Pt[] | null) => void addPhotos([{ blob, corners }]), [addPhotos]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const want = (e as CustomEvent<{ mode: "camera" | "files" }>).detail.mode;
      setOpen(true);
      void warmUpScanner().catch((err: unknown) => toast(err instanceof Error ? err.message : "No se pudo iniciar el escáner.", { tone: "error" }));
      if (want === "files") {
        setMode("pages");
        pickImages((files) => void addPhotos(files.map((blob) => ({ blob }))));
      } else setMode("camera");
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, [addPhotos]);

  // Pegar una imagen (Ctrl+V) agrega una página.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      // Antes que el importador general (que la guardaría como archivo suelto).
      e.preventDefault();
      e.stopImmediatePropagation();
      void addPhotos(files.map((blob) => ({ blob })));
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [open, addPhotos]);

  // El texto junto se arma solo mientras el usuario no lo haya editado.
  const ocrText = pages
    .map((p) => p.ocr?.text ?? "")
    .filter(Boolean)
    .join("\n\n");
  useEffect(() => {
    if (!textEdited) setText(ocrText);
  }, [ocrText, textEdited]);
  useEffect(() => {
    if (!title && ocrText) setTitle(guessTitle(ocrText));
  }, [ocrText, title]);

  const reset = () => {
    for (const p of pagesRef.current) {
      URL.revokeObjectURL(p.sourceUrl);
      if (p.result) URL.revokeObjectURL(p.result.url);
    }
    setPages([]);
    setText("");
    setTextEdited(false);
    setTitle("");
    setEditing(null);
    setDraft(null);
    void stopOcr();
  };

  const close = () => {
    if (pagesRef.current.length && !window.confirm("¿Descartar las páginas escaneadas sin guardar?")) return;
    reset();
    setOpen(false);
  };

  // Reconoce el texto de las páginas que todavía no lo tienen.
  const runOcr = async (): Promise<Page[]> => {
    const list = pagesRef.current;
    const todo = list.filter((p) => p.result && !p.ocr);
    if (!todo.length) return list;
    let n = 0;
    const done = new Map<string, OcrResult>();
    for (const p of todo) {
      setWorking(`Reconociendo el texto… página ${++n} de ${todo.length}`);
      patch(p.id, { ocrBusy: true });
      try {
        const ocr = await recognize(p.result!.blob);
        done.set(p.id, ocr);
        patch(p.id, { ocr, ocrBusy: false });
      } catch {
        patch(p.id, { ocrBusy: false });
        toast("No pudimos reconocer el texto de una página.", { tone: "error" });
      }
    }
    setWorking("");
    return pagesRef.current.map((p) => (done.has(p.id) ? { ...p, ocr: done.get(p.id) } : p));
  };

  const ready = pages.length > 0 && pages.every((p) => p.result && !p.busy);
  const name = () => safeFileName(title.trim() || `Escaneo ${new Date().toLocaleDateString("es-AR").replace(/\//g, "-")}`);

  const makePdf = async (withText: boolean) => {
    const list = withText ? await runOcr() : pagesRef.current;
    setWorking("Armando el PDF…");
    try {
      return await buildPdf(
        list.filter((p) => p.result).map((p) => ({ jpeg: p.result!.blob, width: p.result!.width, height: p.result!.height, words: p.ocr?.words })),
        size,
        title.trim() || "Escaneo",
      );
    } finally {
      setWorking("");
    }
  };

  const allText = (list: Page[]) =>
    textEdited
      ? text
      : list
          .map((p) => p.ocr?.text ?? "")
          .filter(Boolean)
          .join("\n\n");

  const finish = (view: Parameters<typeof openView>[0]) => {
    reset();
    setOpen(false);
    openView(view, "tab");
  };

  const saveAsPdf = async () => {
    const folder = await pickFolder("¿Dónde guardo el PDF?");
    if (!folder) return;
    const pdf = await makePdf(true);
    const id = await createOfficeDoc({ kind: "pdf", subjectId: folder, name: `${name()}.pdf`, file: pdf });
    await db.officeDocs.update(id, { textCache: allText(pagesRef.current).slice(0, 60000) });
    toast("PDF guardado.");
    finish({ type: "editor", id });
  };

  const saveToBibliography = async () => {
    const folder = await pickFolder("¿En la bibliografía de qué materia?");
    if (!folder) return;
    if (isSpecialFolder(folder)) {
      toast("La bibliografía es de una materia: elegí una materia, no una carpeta.", { tone: "error" });
      return;
    }
    const pdf = await makePdf(true);
    const fileName = `${name()}.pdf`;
    const url = await saveFile(new File([pdf], fileName, { type: "application/pdf" }));
    const id = newId();
    await db.documents.add({
      id,
      subjectId: folder,
      unitNumber: 1,
      fileName,
      extractedText: allText(pagesRef.current),
      pageCount: pagesRef.current.length,
      fileId: url.slice(6),
      usedOcr: true,
      createdAt: nowIso(),
    });
    toast("Agregado a la bibliografía.");
    finish({ type: "pdf", id });
  };

  const saveAsNote = async (withImages: boolean) => {
    const folder = await pickFolder("¿Dónde creo la nota?");
    if (!folder) return;
    const list = await runOcr();
    const body = allText(list);
    const blocks: unknown[] = [];
    if (withImages) {
      for (const p of list) if (p.result) blocks.push({ type: "image", props: { url: await saveFile(p.result.blob, `${name()}.jpg`), name: `${name()}.jpg` } });
    }
    blocks.push(...markdownToBlocks(body));
    const id = await createNote({ subjectId: folder, title: title.trim() || name(), unitNumber: 1, content: blocks, plainTextCache: body });
    toast("Nota creada.");
    finish({ type: "nota", id });
  };

  const download = async () => {
    const pdf = await makePdf(true);
    await saveBlob(`${name()}.pdf`, pdf);
  };

  // IA chica (la local): ordena el texto del OCR en Markdown prolijo y le pone título.
  const tidyWithAI = async () => {
    const list = await runOcr();
    const raw = allText(list).slice(0, 12000);
    if (!raw.trim()) return toast("No hay texto para ordenar.", { tone: "error" });
    setWorking("La IA está ordenando el texto…");
    try {
      const out = await ai.generate(
        [
          {
            role: "system",
            content:
              "Corregís texto sacado de un escaneo con OCR. Arreglás palabras cortadas, letras mal leídas y saltos de renglón, sin inventar ni resumir. " +
              'Respondé sólo JSON: {"titulo": "título corto", "markdown": "el texto en Markdown con títulos (##), listas y párrafos"}.',
          },
          { role: "user", content: raw },
        ],
        { json: true, maxTokens: 4096, temperature: 0.2 },
      );
      const m = out.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : out) as { titulo?: string; markdown?: string };
      if (parsed.markdown?.trim()) {
        setText(parsed.markdown.trim());
        setTextEdited(true);
      }
      if (parsed.titulo?.trim()) setTitle(parsed.titulo.trim().slice(0, 80));
    } catch {
      toast("La IA no pudo ordenar el texto. Revisá Ajustes > IA.", { tone: "error" });
    } finally {
      setWorking("");
    }
  };

  const guard = (fn: () => Promise<unknown>) => () =>
    void fn().catch((e: unknown) => {
      setWorking("");
      toast(e instanceof Error ? e.message : "Algo salió mal.", { tone: "error" });
    });

  const saveMenu: MenuItem[] = [
    { label: "PDF en una carpeta", icon: FileText, onSelect: guard(saveAsPdf) },
    { label: "PDF en la bibliografía de una materia", icon: BookOpen, onSelect: guard(saveToBibliography) },
    { type: "separator" },
    { label: "Nota con el texto", icon: FilePlus, onSelect: guard(() => saveAsNote(false)) },
    { label: "Nota con las imágenes y el texto", icon: ImagePlus, onSelect: guard(() => saveAsNote(true)) },
    { type: "separator" },
    { label: "Descargar PDF", icon: Download, onSelect: guard(download) },
  ];

  const startEdit = (p: Page) => {
    setEditing(p.id);
    setDraft({ corners: p.corners, filter: p.filter, rotation: p.rotation });
    setMode("edit");
  };

  const edited = pages.find((p) => p.id === editing);

  const applyEdit = () => {
    if (edited && draft) {
      try {
        localStorage.setItem(LS_FILTER, draft.filter);
      } catch {}
      void process(edited, draft.corners, draft.filter, draft.rotation);
    }
    setMode("pages");
    setEditing(null);
    setDraft(null);
  };

  const removePage = (id: string) =>
    setPages((list) => {
      const p = list.find((x) => x.id === id);
      if (p) {
        URL.revokeObjectURL(p.sourceUrl);
        if (p.result) URL.revokeObjectURL(p.result.url);
      }
      return list.filter((x) => x.id !== id);
    });

  const movePage = (from: string, to: string) =>
    setPages((list) => {
      const a = list.findIndex((x) => x.id === from);
      const b = list.findIndex((x) => x.id === to);
      if (a < 0 || b < 0 || a === b) return list;
      const next = [...list];
      const [it] = next.splice(a, 1);
      next.splice(b, 0, it);
      return next;
    });

  const setAllFilters = (filter: ScanFilter) => {
    try {
      localStorage.setItem(LS_FILTER, filter);
    } catch {}
    for (const p of pagesRef.current) if (p.filter !== filter) void process(p, p.corners, filter, p.rotation);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border px-3">
        {mode === "edit" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setMode("pages"), setEditing(null), setDraft(null))}>
            <ArrowLeft />
            Volver
          </button>
        ) : (
          <ScanLine className="h-4 w-4 text-primary-soft" strokeWidth={1.75} />
        )}
        <span className="t-label text-muted">Escáner</span>
        {mode !== "camera" && pages.length > 0 && <span className="t-small text-faint">{pages.length === 1 ? "1 página" : `${pages.length} páginas`}</span>}
        {working && (
          <span className="t-small flex items-center gap-1.5 text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {working}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {mode === "pages" && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setMode("camera")}>
                <Camera />
                Cámara
              </button>
              <button type="button" className="btn btn-sm" onClick={() => pickImages((files) => void addPhotos(files.map((blob) => ({ blob }))))}>
                <ImagePlus />
                Subir fotos
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!ready || !!working}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu({ clientX: r.left, clientY: r.bottom + 4 }, saveMenu);
                }}
              >
                <Check />
                Guardar
                <ChevronDown />
              </button>
            </>
          )}
          {mode === "edit" && (
            <button type="button" className="btn btn-primary btn-sm" onClick={applyEdit}>
              <Check />
              Aplicar
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el escáner" title="Cerrar" onClick={close}>
            <X />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {mode === "camera" && <ScannerCamera count={pages.length} onCapture={onCapture} onClose={() => setMode("pages")} />}

        {mode === "edit" && edited && draft && (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 p-6">
              <CornerEditor url={edited.sourceUrl} width={edited.sw} height={edited.sh} corners={draft.corners} onChange={(corners) => setDraft({ ...draft, corners })} />
            </div>
            <div className="flex flex-none flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const bmp = await loadBitmap(edited.source);
                  const found = await detectCorners(bmp, bmp.width, bmp.height).catch(() => null);
                  bmp.close();
                  if (found) setDraft({ ...draft, corners: found });
                  else toast("No encontramos los bordes de la hoja: ajustalos a mano.");
                }}
              >
                <ScanLine />
                Detectar la hoja
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, corners: defaultCorners(edited.sw, edited.sh, 0) })}>
                <Crop />
                Toda la foto
              </button>
              <div className="mx-2 h-5 w-px bg-border" />
              <button type="button" className="btn btn-sm btn-icon" aria-label="Rotar a la izquierda" title="Rotar a la izquierda" onClick={() => setDraft({ ...draft, rotation: draft.rotation - 90 })}>
                <RotateCcw />
              </button>
              <button type="button" className="btn btn-sm btn-icon" aria-label="Rotar a la derecha" title="Rotar a la derecha" onClick={() => setDraft({ ...draft, rotation: draft.rotation + 90 })}>
                <RotateCw />
              </button>
              <span className="t-small text-faint">{(((draft.rotation % 360) + 360) % 360) || 0}°</span>
              <div className="mx-2 h-5 w-px bg-border" />
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={draft.filter === f} className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft" onClick={() => setDraft({ ...draft, filter: f })}>
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === "pages" && (
          <div className="flex h-full min-h-0">
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {pages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <ScanLine className="h-10 w-10 text-faint" strokeWidth={1.5} />
                  <div className="t-h3">Escaneá apuntes, fotocopias o pizarrones</div>
                  <div className="t-small max-w-md text-muted">Sacá fotos con la cámara o subilas (también podés pegar una con Ctrl+V). La app encuentra la hoja, la endereza y la deja legible.</div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn btn-primary" onClick={() => setMode("camera")}>
                      <Camera />
                      Usar la cámara
                    </button>
                    <button type="button" className="btn" onClick={() => pickImages((files) => void addPhotos(files.map((blob) => ({ blob }))))}>
                      <ImagePlus />
                      Subir fotos
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDragId(p.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragId && dragId !== p.id) movePage(dragId, p.id);
                      }}
                      onDragEnd={() => setDragId(null)}
                      className={clsx("group flex flex-col gap-1.5", dragId === p.id && "opacity-50")}
                    >
                      <button
                        type="button"
                        title="Ajustar bordes, filtro y rotación"
                        onClick={() => startEdit(p)}
                        className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border bg-surface hover:border-primary"
                      >
                        {p.result ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.result.url} alt={`Página ${i + 1}`} className="max-h-full max-w-full object-contain" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.sourceUrl} alt="" className="max-h-full max-w-full object-contain opacity-40" />
                        )}
                        {(p.busy || p.ocrBusy) && (
                          <span className="absolute inset-0 flex items-center justify-center bg-bg/40">
                            <Loader2 className="h-6 w-6 animate-spin text-primary-soft" />
                          </span>
                        )}
                        {p.error && <span className="absolute inset-x-2 bottom-2 rounded bg-rose-tint px-2 py-1 text-[11px] text-rose">{p.error}</span>}
                      </button>
                      <div className="flex items-center gap-1">
                        <span className="num t-small text-muted">{i + 1}</span>
                        {p.ocr && <span className="badge badge-mint">Texto</span>}
                        <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
                          <button type="button" className="icon-btn" aria-label="Rotar" title="Rotar" onClick={() => void process(p, p.corners, p.filter, p.rotation + 90)}>
                            <RotateCw />
                          </button>
                          <button type="button" className="icon-btn" aria-label="Ajustar" title="Ajustar" onClick={() => startEdit(p)}>
                            <Crop />
                          </button>
                          <button type="button" className="icon-btn hover:text-rose" aria-label="Borrar página" title="Borrar página" onClick={() => removePage(p.id)}>
                            <Trash2 />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMode("camera")}
                    className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-faint hover:border-primary hover:text-text"
                  >
                    <Camera className="h-6 w-6" strokeWidth={1.5} />
                    <span className="t-small">Otra página</span>
                  </button>
                </div>
              )}
            </div>

            {pages.length > 0 && (
              <aside className="flex w-[340px] flex-none flex-col gap-3 overflow-y-auto border-l border-border p-4">
                <label className="field">
                  <span>Nombre</span>
                  <input className="input" value={title} placeholder="Escaneo" onChange={(e) => setTitle(e.target.value)} />
                </label>
                <div className="field">
                  <span>Filtro para todas</span>
                  <div className="flex flex-wrap gap-1.5">
                    {FILTERS.map((f) => (
                      <button key={f} type="button" aria-pressed={pages.every((p) => p.filter === f)} className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft" onClick={() => setAllFilters(f)}>
                        {FILTER_LABEL[f]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span>Tamaño de página del PDF</span>
                  <div className="flex gap-1.5">
                    {(
                      [
                        ["original", "Como la foto"],
                        ["a4", "A4"],
                        ["carta", "Carta"],
                      ] as const
                    ).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={size === k} className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft" onClick={() => setSize(k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field min-h-0 flex-1">
                  <span className="flex items-center gap-2">
                    Texto
                    {textEdited && <span className="badge">Editado</span>}
                  </span>
                  {text ? (
                    <textarea
                      className="input min-h-[220px] flex-1 font-mono text-[12px]"
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        setTextEdited(true);
                      }}
                    />
                  ) : (
                    <div className="t-small rounded-md border border-dashed border-border p-3 text-faint">
                      Se reconoce al guardar, para que el PDF se pueda buscar y la IA lo pueda leer. También podés reconocerlo ahora.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn btn-sm" disabled={!ready || !!working || pages.every((p) => p.ocr)} onClick={guard(runOcr)}>
                      <ScanText />
                      Reconocer texto
                    </button>
                    <button type="button" className="btn btn-ai btn-sm" disabled={!ready || !!working} title="La IA corrige los errores del reconocimiento y le da formato" onClick={guard(tidyWithAI)}>
                      <Sparkles />
                      Ordenar con IA
                    </button>
                    {text && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Texto copiado."))}
                      >
                        <Copy />
                        Copiar
                      </button>
                    )}
                    {textEdited && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTextEdited(false)}>
                        Volver al reconocido
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
      {menu}
    </div>
  );
}
