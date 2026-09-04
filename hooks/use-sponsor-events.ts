"use client";
import { useEffect, useState } from "react";
import { getSponsorEventHistory, subscribeSponsorEvents, type SponsorEvent } from "@/lib/sponsor-event-bus";

/** Live-subscribes to the sponsor event bus (lib/sponsor-event-bus.ts) — newest event first, seeded with whatever already happened before this component mounted. */
export function useSponsorEvents(): SponsorEvent[] {
  const [events, setEvents] = useState<SponsorEvent[]>(() => getSponsorEventHistory());

  useEffect(() => {
    // Re-sync on mount in case events fired between the initial useState call and this effect attaching.
    setEvents(getSponsorEventHistory());
    return subscribeSponsorEvents((event) => setEvents((prev) => [event, ...prev].slice(0, 300)));
  }, []);

  return events;
}
