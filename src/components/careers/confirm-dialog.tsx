"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";

// Confirmación de borrado dentro de la UI (nada se borra sin este paso).
export function ConfirmDialog({
  title,
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm();
    } catch {
      setError("No pudimos eliminar. Probá de nuevo.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="t-body text-muted">{message}</p>
      {error && <p className="t-small mt-3 text-rose" role="alert">{error}</p>}
    </Modal>
  );
}
