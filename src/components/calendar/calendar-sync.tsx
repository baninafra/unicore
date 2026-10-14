"use client";

import { useEffect } from "react";
import { useSettings } from "@/components/settings/apply-settings";
import { syncAllCalendars } from "@/lib/calendars/sync";

// Sincroniza los calendarios externos al abrir la app y después cada tanto (según Ajustes > Calendario).
export function CalendarSync() {
  const [settings] = useSettings();
  const minutes = settings.calendarSyncMinutes;

  useEffect(() => {
    void syncAllCalendars().catch(() => {});
  }, []);

  useEffect(() => {
    if (!minutes) return;
    const t = window.setInterval(() => void syncAllCalendars().catch(() => {}), minutes * 60_000);
    return () => window.clearInterval(t);
  }, [minutes]);

  return null;
}
