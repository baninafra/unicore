"use client";

import { useEffect, useState } from "react";

// Hora actual, refrescada cada minuto. Arranca en undefined para que el servidor
// y el primer render del navegador coincidan (sin diferencias de hidratación).
export function useNow(intervalMs = 60_000): Date | undefined {
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
