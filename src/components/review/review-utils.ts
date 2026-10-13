// Helpers del repaso (sin React).

// "1 tarjeta" / "24 tarjetas"
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Estimación: unos 30 segundos por tarjeta, mínimo 1 minuto.
export function minutesFor(cardCount: number): number {
  return Math.max(1, Math.round(cardCount * 0.5));
}

export function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
