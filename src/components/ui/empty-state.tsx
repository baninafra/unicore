import type { LucideIcon } from "lucide-react";

// Pantalla vacía: invita a hacer la primera acción.
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon className="h-6 w-6 text-faint" strokeWidth={1.75} />
      <div className="t-h3">{title}</div>
      {text && <p className="t-small max-w-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}
