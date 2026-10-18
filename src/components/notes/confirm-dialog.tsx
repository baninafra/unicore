"use client";

import { useEffect, useRef } from "react";
import { deleteWithUndo } from "@/lib/undo";
import { t } from "@/lib/i18n";

// Antes preguntaba "¿Eliminar…?". Ahora borra al toque y muestra "Deshacer" (no pregunta dos veces).
export function ConfirmDialog({
  open,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (!open) {
      fired.current = false;
      return;
    }
    if (fired.current) return;
    fired.current = true;
    const name = text.match(/["«]([^"»]+)["»]/)?.[1];
    void deleteWithUndo(name ? t("Se eliminó «{name}»", { name }) : confirmLabel.replace(/^Eliminar\s*/i, t("Se eliminó ")), onConfirm).catch(() => undefined);
    onClose();
  }, [open, text, confirmLabel, onConfirm, onClose]);
  return null;
}
