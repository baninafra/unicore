"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n";
import { deleteWithUndo } from "@/lib/undo";

// Borra al toque (sin preguntar dos veces) y muestra un aviso con "Deshacer".
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const name = message.match(/["«]([^"»]+)["»]/)?.[1];
    void deleteWithUndo(name ? t("Se eliminó «{name}»", { name }) : confirmLabel.replace(/^Eliminar\s*/i, "Se eliminó "), onConfirm)
      .catch(() => undefined)
      .finally(onClose);
  }, [message, confirmLabel, onConfirm, onClose]);
  return null;
}
