"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, ChevronsUpDown, FolderOpen, GraduationCap, Inbox, Layers, LayoutDashboard, Moon, Sparkles, Sun } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useDegrees, useSubjects } from "@/lib/hooks";
import { isDesktop, openDataFolder } from "@/lib/desktop";

const NAV = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/carreras", label: "Mis carreras", icon: GraduationCap },
  { href: "/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/mails", label: "Mails", icon: Inbox, key: "mails" },
  { href: "/repaso", label: "Repaso", icon: Layers, key: "repaso" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { degreeFilter, setDegreeFilter, setAiOpen, theme, toggleTheme, currentSubjectId } = useAppState();
  const degrees = useDegrees();
  const subjects = useSubjects();
  const cursando = subjects.filter((s) => s.status === "CURSANDO").sort((a, b) => a.name.localeCompare(b.name));

  const mailCount = useLiveQuery(() => db.tasks.where("status").equals("INBOX_EMAIL").count(), []) ?? 0;
  const dueCards = useLiveQuery(() => db.flashcards.where("due").belowOrEqual(new Date().toISOString()).count(), []) ?? 0;

  return (
    <aside className="flex h-full w-[232px] flex-none flex-col gap-4 border-r border-border bg-surface px-2.5 py-3.5">
      <Logo />

      <label className="relative block">
        <span className="sr-only">Carrera</span>
        <select
          className="input h-10 cursor-pointer appearance-none pr-8 font-medium"
          value={degreeFilter}
          onChange={(e) => setDegreeFilter(e.target.value)}
        >
          <option value="all">Todas mis carreras</option>
          {degrees.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-faint" />
      </label>

      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon, key }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className="nav-item" aria-current={active ? "page" : undefined}>
              <Icon strokeWidth={1.75} />
              {label}
              {key === "mails" && mailCount > 0 && <span className="badge badge-amber ml-auto h-5">{mailCount}</span>}
              {key === "repaso" && dueCards > 0 && <span className="num ml-auto text-xs text-faint">{dueCards}</span>}
            </Link>
          );
        })}
      </nav>

      {cursando.length > 0 && (
        <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          <span className="t-label px-2.5 pb-1.5">Cursando</span>
          {cursando.map((s) => (
            <Link
              key={s.id}
              href={`/materia?id=${s.id}`}
              className="nav-item"
              aria-current={pathname.startsWith("/materia") && currentSubjectId === s.id ? "page" : undefined}
            >
              <span className="truncate">{s.name}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
        <button className="nav-item w-full" onClick={() => setAiOpen(true)}>
          <Sparkles strokeWidth={1.75} className="text-primary-soft" />
          Asistente IA
          <span className="kbd ml-auto">Ctrl J</span>
        </button>
        {isDesktop() && (
          <button className="nav-item w-full" onClick={() => openDataFolder()} title="DocumentosUniCore">
            <FolderOpen strokeWidth={1.75} />
            Carpeta de datos
          </button>
        )}
        <button className="nav-item w-full" onClick={toggleTheme}>
          {theme === "dark" ? <Sun strokeWidth={1.75} /> : <Moon strokeWidth={1.75} />}
          {theme === "dark" ? "Tema claro" : "Tema oscuro"}
        </button>
      </div>
    </aside>
  );
}
