"use client";

// Clic derecho y clic del medio en toda la app.
// - Clic derecho: si el elemento no tiene su propio menú, aparece uno según dónde se hizo clic
//   (texto, campo editable, link, imagen o fondo).
// - Clic del medio (ruedita): lo que se puede abrir se abre en una pestaña nueva.

import { useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FilePlus,
  Globe,
  Image as ImageIcon,
  ListPlus,
  Download,
  Redo2,
  Scissors,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  TextSelect,
  Undo2,
  Command as CommandIcon,
} from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useAppState } from "@/lib/app-state";
import { consumeOpened, useWorkspace, withOpenMode } from "@/lib/workspace";
import { newNoteForView } from "@/lib/nav/actions";
import { openPalette } from "@/lib/nav/palette-bus";
import { saveBlob, safeFileName } from "@/lib/export/save";
import { resolveFileUrl } from "@/lib/db";
import { isDesktop } from "@/lib/desktop";

const CLICKABLE = 'a[href], button, [role="button"], [role="treeitem"], [role="option"], [role="link"], [role="row"], [data-open], .row, .card-hover';
// Acciones que no conviene disparar con la ruedita.
const RISKY = /eliminar|borrar|quitar|cerrar|descartar|marcar|completar|hecha|archivar|detener/i;

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && /^(text|search|email|url|tel|number|password|)$/.test(el.type);
  return (el as HTMLElement).isContentEditable;
}

function selectedText(): string {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) {
    try {
      return a.value.slice(a.selectionStart ?? 0, a.selectionEnd ?? 0);
    } catch {
      return "";
    }
  }
  return window.getSelection()?.toString() ?? "";
}

function externalUrl(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, window.location.href);
    return /^https?:$/.test(u.protocol) && u.origin !== window.location.origin ? u.href : null;
  } catch {
    return null;
  }
}

async function openExternal(url: string) {
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

async function imageBlob(img: HTMLImageElement): Promise<Blob> {
  const src = img.currentSrc || img.src;
  const r = await fetch(src.startsWith("idb://") ? await resolveFileUrl(src) : src);
  return r.blob();
}

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png"));
}

export function GlobalMouse() {
  const { openView, activeView, setRight } = useWorkspace();
  const { openTaskDialog } = useAppState();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const ctx = useRef({ openView, activeView, setRight, openTaskDialog });
  ctx.current = { openView, activeView, setRight, openTaskDialog };

  useEffect(() => {
    const askAI = (text: string) => {
      ctx.current.setRight(true, "ia");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("uc:ai-ask", { detail: { text: `"${text.trim()}"\n` } })), 80);
    };

    const textItems = (text: string): MenuItem[] =>
      text.trim()
        ? [
            { type: "separator" },
            { label: "Preguntar a la IA", icon: Sparkles, onSelect: () => askAI(text) },
            { label: "Buscar en UniCore", icon: Search, onSelect: () => ctx.current.openView({ type: "busqueda", query: text.trim().slice(0, 200) }, "tab") },
            {
              label: "Buscar en internet",
              icon: Globe,
              onSelect: () => ctx.current.openView({ type: "web", url: `https://duckduckgo.com/?q=${encodeURIComponent(text.trim().slice(0, 200))}` }, "tab"),
            },
          ]
        : [];

    const onContext = (e: MouseEvent) => {
      // Si el elemento ya mostró su propio menú, no hacemos nada.
      if (e.defaultPrevented) return;
      const target = e.target as Element;
      if (target.closest("[data-native-menu]")) return;
      e.preventDefault();

      const items: MenuItem[] = [];
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      const img = target.closest("img") as HTMLImageElement | null;
      const editable = isEditable(target.closest("input, textarea, [contenteditable='true'], [contenteditable='']") ?? (target as HTMLElement));
      const text = selectedText();

      const url = externalUrl(link?.getAttribute("href") ?? null);
      if (url) {
        items.push(
          { label: "Abrir en pestaña nueva", icon: SquareArrowOutUpRight, onSelect: () => ctx.current.openView({ type: "web", url }, "tab") },
          { label: "Abrir en el navegador", icon: ExternalLink, onSelect: () => void openExternal(url) },
          { label: "Copiar link", icon: Copy, onSelect: () => void navigator.clipboard.writeText(url) },
          { type: "separator" },
        );
      }
      if (img) {
        items.push(
          {
            label: "Copiar imagen",
            icon: ImageIcon,
            onSelect: async () => {
              const png = await toPng(await imageBlob(img));
              await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            },
          },
          {
            label: "Guardar imagen",
            icon: Download,
            onSelect: async () => {
              const b = await imageBlob(img);
              const ext = b.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
              await saveBlob(`${safeFileName(img.alt || "imagen")}.${ext}`, b);
            },
          },
          { type: "separator" },
        );
      }

      if (editable) {
        const el = target.closest("input, textarea, [contenteditable]") as HTMLElement | null;
        el?.focus({ preventScroll: true });
        items.push(
          { label: "Deshacer", icon: Undo2, hint: "Ctrl+Z", onSelect: () => void document.execCommand("undo") },
          { label: "Rehacer", icon: Redo2, hint: "Ctrl+Y", onSelect: () => void document.execCommand("redo") },
          { type: "separator" },
          { label: "Cortar", icon: Scissors, hint: "Ctrl+X", disabled: !text, onSelect: () => void document.execCommand("cut") },
          { label: "Copiar", icon: Copy, hint: "Ctrl+C", disabled: !text, onSelect: () => void document.execCommand("copy") },
          {
            label: "Pegar",
            icon: ClipboardPaste,
            hint: "Ctrl+V",
            onSelect: async () => {
              el?.focus({ preventScroll: true });
              try {
                // Si hay una imagen en el portapapeles, la pegamos como archivo (el editor la sube).
                const items = await navigator.clipboard.read();
                for (const it of items) {
                  const type = it.types.find((t) => t.startsWith("image/"));
                  if (type && el) {
                    const blob = await it.getType(type);
                    const dt = new DataTransfer();
                    dt.items.add(new File([blob], `imagen.${type.split("/")[1]}`, { type }));
                    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
                    return;
                  }
                }
              } catch {
                // sin permiso para leer imágenes: probamos sólo texto
              }
              const t = await navigator.clipboard.readText().catch(() => "");
              if (t) document.execCommand("insertText", false, t);
            },
          },
          { label: "Seleccionar todo", icon: TextSelect, hint: "Ctrl+A", onSelect: () => void document.execCommand("selectAll") },
          ...textItems(text),
        );
      } else if (text.trim()) {
        items.push({ label: "Copiar", icon: Copy, hint: "Ctrl+C", onSelect: () => void navigator.clipboard.writeText(text) }, ...textItems(text).slice(1));
      }

      if (!items.length || items.every((i) => i.type === "separator")) {
        items.length = 0;
        items.push(
          { label: "Nueva nota", icon: FilePlus, onSelect: async () => ctx.current.openView({ type: "nota", id: await newNoteForView(ctx.current.activeView) }, "tab") },
          { label: "Nueva tarea", icon: ListPlus, onSelect: () => ctx.current.openTaskDialog() },
          { label: "Preguntar a la IA", icon: Sparkles, onSelect: () => ctx.current.setRight(true, "ia") },
          { type: "separator" },
          { label: "Buscar", icon: Search, hint: "Ctrl+Shift+F", onSelect: () => ctx.current.openView({ type: "busqueda" }, "tab") },
          { label: "Paleta de comandos", icon: CommandIcon, hint: "Ctrl+P", onSelect: () => openPalette({ mode: "commands" }) },
        );
      }
      while (items[items.length - 1]?.type === "separator") items.pop();
      setMenu({ x: e.clientX, y: e.clientY, items });
    };

    // La ruedita no tiene que activar el auto-desplazamiento sobre cosas que se abren.
    const onDown = (e: MouseEvent) => {
      if (e.button === 1 && (e.target as Element).closest?.(CLICKABLE)) e.preventDefault();
    };

    const onAux = (e: MouseEvent) => {
      if (e.button !== 1 || e.defaultPrevented) return;
      const target = e.target as Element;
      if (target.closest('[role="tab"], [role="tablist"], input, textarea, select, [contenteditable="true"] :not(a)')) return;
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      const url = externalUrl(link?.getAttribute("href") ?? null);
      if (url) {
        e.preventDefault();
        ctx.current.openView({ type: "web", url }, "tab");
        return;
      }
      const el = target.closest(CLICKABLE) as HTMLElement | null;
      if (!el || el.closest(".btn-danger") || (el instanceof HTMLButtonElement && el.disabled)) return;
      const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.textContent?.slice(0, 40) ?? ""}`;
      if (RISKY.test(label)) return;
      e.preventDefault();
      consumeOpened();
      // Simulamos un Ctrl+clic: los que abren vistas lo toman como "pestaña nueva".
      withOpenMode("tab", () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, clientX: e.clientX, clientY: e.clientY, view: window }));
      });
      consumeOpened();
    };

    window.addEventListener("contextmenu", onContext);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("auxclick", onAux);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("auxclick", onAux);
    };
  }, []);

  return menu ? <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null;
}
