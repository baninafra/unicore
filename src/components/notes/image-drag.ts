"use client";

// Mover imágenes de una nota agarrándolas directamente (no sólo con la manija del costado).
// Se sueltan arriba o abajo de cualquier bloque, y según dónde quede el mouse se alinean a la
// izquierda, al centro o a la derecha.

import type { NoteBlockEditor } from "./note-schema";

type Align = "left" | "center" | "right";

export function startImageDrag(e: PointerEvent, editor: NoteBlockEditor, root: HTMLElement): boolean {
  const target = e.target as HTMLElement;
  if (e.button !== 0 || target.tagName !== "IMG") return false;
  if (target.closest(".bn-resize-handle, [class*='resize']")) return false;
  const outer = target.closest<HTMLElement>(".bn-block-outer[data-id]");
  const content = target.closest<HTMLElement>("[data-content-type='image']");
  if (!outer || !content || !editor.isEditable) return false;
  const blockId = outer.dataset.id!;

  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let ghost: HTMLImageElement | null = null;
  const line = document.createElement("div");
  line.className = "uc-drop-line";
  let drop: { id: string; place: "before" | "after"; align: Align } | null = null;

  const editorEl = root.querySelector<HTMLElement>(".bn-editor") ?? root;

  const onMove = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      dragging = true;
      ghost = target.cloneNode() as HTMLImageElement;
      const w = Math.min(220, target.getBoundingClientRect().width);
      Object.assign(ghost.style, {
        position: "fixed",
        width: `${w}px`,
        pointerEvents: "none",
        opacity: "0.75",
        zIndex: "80",
        borderRadius: "6px",
        boxShadow: "var(--shadow-pop)",
      });
      document.body.append(ghost, line);
      document.body.style.cursor = "grabbing";
      outer.style.opacity = "0.35";
    }
    ev.preventDefault();
    ghost!.style.left = `${ev.clientX + 8}px`;
    ghost!.style.top = `${ev.clientY + 8}px`;

    // Bloque de primer nivel bajo el mouse (o el más cercano).
    const blocks = [...editorEl.querySelectorAll<HTMLElement>(":scope .bn-block-group > .bn-block-outer[data-id]")].filter(
      (b) => b.dataset.id !== blockId && !b.parentElement?.closest(".bn-block-outer"),
    );
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const b of blocks) {
      const r = b.getBoundingClientRect();
      const d = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0;
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    const er = editorEl.getBoundingClientRect();
    const rel = (ev.clientX - er.left) / er.width;
    const align: Align = rel < 0.33 ? "left" : rel > 0.67 ? "right" : "center";
    if (!best) {
      drop = null;
      line.style.display = "none";
      return;
    }
    const r = best.getBoundingClientRect();
    const place = ev.clientY < r.top + r.height / 2 ? "before" : "after";
    drop = { id: best.dataset.id!, place, align };
    Object.assign(line.style, {
      display: "block",
      left: `${er.left + (align === "left" ? 0 : align === "center" ? er.width * 0.25 : er.width * 0.5)}px`,
      width: `${er.width * 0.5}px`,
      top: `${(place === "before" ? r.top : r.bottom) - 1}px`,
    });
  };

  const finish = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", finish, true);
    ghost?.remove();
    line.remove();
    document.body.style.cursor = "";
    outer.style.opacity = "";
    if (!dragging || !drop) return;
    const block = editor.getBlock(blockId);
    if (!block) return;
    const moved = { ...block, props: { ...(block.props as object), textAlignment: drop.align } };
    editor.transact(() => {
      editor.removeBlocks([blockId]);
      editor.insertBlocks([moved as never], drop!.id, drop!.place);
    });
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", finish, true);
  return true;
}
