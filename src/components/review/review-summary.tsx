"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { plural } from "./review-utils";

// Cierre del repaso en una línea: tiempo usado y cuántas tarjetas te tocan mañana (dentro del mismo filtro).
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

  const tomorrowText = tomorrow === null ? "" : tomorrow === 0 ? " · mañana no te tocan" : ` · mañana te tocan ${tomorrow}`;

  return (
    <p className="t-body text-center text-muted">
      Repasaste {plural(total, "tarjeta", "tarjetas")} en {plural(minutes, "minuto", "minutos")}
      {tomorrowText}
    </p>
  );
}
