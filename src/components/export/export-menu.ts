"use client";

import { FileDown, FileText, FileType2, Globe, Sheet, type LucideIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import type { MenuItem } from "@/components/ui/menu";
import type { ExportTarget } from "@/lib/export/export-pdf";
import { exportAs, type ExportFormat } from "@/lib/export/export-formats";
import { toast } from "@/lib/undo";

const OPTIONS: { format: ExportFormat; label: string; icon: LucideIcon }[] = [
  { format: "pdf", label: "PDF", icon: FileDown },
  { format: "docx", label: "Word (.docx)", icon: FileType2 },
  { format: "xlsx", label: "Excel (.xlsx)", icon: Sheet },
  { format: "md", label: "Markdown (.md)", icon: FileText },
  { format: "html", label: t("Página web (.html)"), icon: Globe },
];

// Ítem "Exportar" de los menús contextuales: al pasar el mouse o hacer clic muestra los formatos.
export function exportMenuItem(target: ExportTarget): MenuItem {
  return {
    label: t("Exportar"),
    icon: FileDown,
    submenu: OPTIONS.map((o) => ({
      label: o.label,
      icon: o.icon,
      onSelect: () =>
        exportAs(o.format, target).catch((e) => {
          console.error("[UniCore] exportar", e);
          toast(t("No pudimos exportar. Probá de nuevo."), { tone: "error" });
        }),
    })),
  };
}
