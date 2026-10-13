"use client";

import { Modal } from "@/components/ui/modal";

// Confirmación antes de borrar algo.
export function ConfirmDialog({
  open,
  title,
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="t-body text-muted">{text}</p>
    </Modal>
  );
}
