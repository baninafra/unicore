"use client";

import clsx from "clsx";

// Campo con etiqueta y error inline. El error va fuera del <label> para que no tome el estilo de .field > span.
export function FormField({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label className="field">
        <span>{label}</span>
        {children}
      </label>
      {error && (
        <p className="t-small text-rose" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
