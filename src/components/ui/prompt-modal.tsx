"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";

// Pide un texto (nombre de nota, carpeta, espacio de trabajo...). Enter confirma, Esc cancela.
export function PromptModal({
  open,
  title,
  initial = "",
  placeholder,
  confirmLabel = "Listo",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setTimeout(() => ref.current?.select(), 0);
    }
  }, [open, initial]);
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <input
        ref={ref}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
    </Modal>
  );
}
