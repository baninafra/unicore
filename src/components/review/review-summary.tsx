"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { db } from "@/lib/db";
import { plural } from "./review-utils";

// Cierre del repaso: tiempo usado y cuántas tarjetas te tocan mañana (dentro del mismo filtro).
export function ReviewSummary({ total, minutes, subjectIds }: { total: number; minutes: number; subjectIds: string[] }) {
  const [tomorrow, setTomorrow] = useState<number | null>(null);

  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() + 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const ids = new Set(subjectIds);
    let cancelled = false;
    db.flashcards
      .where("due")
      .between(from.toISOString(), to.toISOString(), true, false)
      .toArray()
      .then((list) => {
        if (!cancelled) setTomorrow(list.filter((c) => ids.has(c.subjectId)).length);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [subjectIds]);

  const tomorrowText =
    tomorrow === null ? "" : tomorrow === 0 ? "Mañana no te tocan tarjetas." : `Mañana te tocan ${tomorrow}.`;

  return (
    <div className="card mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <Check className="h-6 w-6 text-mint" strokeWidth={1.75} />
      <p className="t-h2">
        Repasaste {plural(total, "tarjeta", "tarjetas")} en {plural(minutes, "minuto", "minutos")}.
      </p>
      {tomorrowText && <p className="t-body text-muted">{tomorrowText}</p>}
      <Link href="/" className="btn mt-2">
        Volver a Inicio
      </Link>
    </div>
  );
}
