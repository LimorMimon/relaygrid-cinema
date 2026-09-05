"use client";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type StreamRecord } from "@/lib/domains/cinema";

// Deliberately the BRIGHT base tokens at low opacity, not the pre-darkened
// "-soft" badge variants — the "-soft" swatches are already near-black and
// barely separate from the panel background across a full-width row, even
// at high opacity. A wash of the saturated color reads as unmistakably
// tinted at a glance down a dense 220-row table.
const statusRowClasses: Record<StreamRecord["status"], string> = {
  // No wash at all, on purpose — Healthy is the majority status (most of
  // 220 rows), so the fastest scan signal is "colored row = needs a look,
  // blank row = fine" rather than trading one color for another. It also
  // means a row that just got fixed reads as a bigger visual relief
  // (color → no color) than a same-weight color swap would. The badge in
  // the last column still labels it green explicitly for anyone checking
  // that specific row.
  Healthy: "hover:bg-panel-2",
  Degraded: "bg-caution/[0.16] hover:bg-caution/25",
  // Deliberately the strongest wash of the five — Failing is the single
  // worst status a stream can be in, and should read as more urgent than
  // Degraded, not just differently colored.
  Failing: "bg-alert/[0.26] hover:bg-alert/36",
  Rerouted: "bg-signal/[0.14] hover:bg-signal/22",
  "Auto-Resolved": "bg-auto/[0.16] hover:bg-auto/25",
};
/** Applied to the first `<td>` only — a left border on `<tr>` itself renders unreliably under border-collapse. */
const statusAccentClasses: Record<StreamRecord["status"], string> = {
  Healthy: "border-l-2 border-transparent",
  Degraded: "border-l-2 border-caution",
  // Thicker than the other four (border-l-4 vs border-l-2) — the one status
  // that should never blend into the rest of the table.
  Failing: "border-l-4 border-alert",
  Rerouted: "border-l-2 border-signal",
  "Auto-Resolved": "border-l-2 border-auto",
};
const statusIdTextClasses: Record<StreamRecord["status"], string> = {
  Healthy: "text-signal",
  Degraded: "text-caution",
  Failing: "text-alert font-bold",
  Rerouted: "text-signal",
  "Auto-Resolved": "text-auto",
};
const statusBadgeClasses: Record<StreamRecord["status"], string> = {
  Healthy: "border-good/40 bg-good-soft text-good",
  Degraded: "border-caution/40 bg-caution-soft text-caution",
  Failing: "border-alert/40 bg-alert-soft text-alert",
  Rerouted: "border-signal/40 bg-signal-soft text-signal",
  "Auto-Resolved": "border-auto/40 bg-auto-soft text-auto",
};
const statusDotClasses: Record<StreamRecord["status"], string> = {
  Healthy: "bg-good",
  Degraded: "bg-caution",
  Failing: "animate-pulse-dot-alert bg-alert",
  Rerouted: "animate-pulse-dot bg-signal",
  "Auto-Resolved": "animate-pulse-dot-auto bg-auto",
};

export function RelayGrid({
  visibleBatch,
  totalMatches,
  totalRecords,
  selectedId,
  pendingIds,
  recentlyChangedIds,
  onSelect,
}: {
  visibleBatch: StreamRecord[];
  totalMatches: number;
  totalRecords: number;
  selectedId?: string | null;
  pendingIds?: ReadonlySet<string>;
  /** Records a human-approved or autonomous action just changed — flashed briefly so the change is unmissable. */
  recentlyChangedIds?: ReadonlySet<string>;
  onSelect: (record: StreamRecord) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded border border-line bg-panel">
      <div className="shrink-0 flex items-center justify-between border-b border-line bg-panel-2 px-4 py-2.5">
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-ink">
          {totalMatches === totalRecords
            ? `${totalRecords.toLocaleString()} streams`
            : `${totalMatches.toLocaleString()} of ${totalRecords.toLocaleString()} streams`}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
          Showing {visibleBatch.length.toLocaleString()} · {Math.max(0, totalMatches - visibleBatch.length).toLocaleString()} more
          match
        </span>
      </div>
      {/* The only scrolling surface — the count bar above stays put, and the
          header row stays pinned (sticky) while the 220 rows scroll under it. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 border-b border-line bg-void-2 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
            <tr>
              {["Stream ID", "Channel / Program", "CDN Provider", "Bitrate (Mbps)", "FPS", "Audio Status", "Subtitle Sync", "Status Flags", ""].map(
                (label) => (
                  <th key={label} className="whitespace-nowrap px-3 py-2.5">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visibleBatch.map((r) => {
              const isSelected = r.id === selectedId;
              const isPending = pendingIds?.has(r.id);
              const isFlashing = recentlyChangedIds?.has(r.id);
              const flash = isFlashing ? " animate-cell-flash" : "";
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className={`cursor-pointer border-b border-line/70 transition-colors last:border-b-0 ${statusRowClasses[r.status]} ${
                    // Neutral, not a status hue — "selected" means "this is what
                    // I'm looking at," never "this row is healthy/rerouted." A
                    // fixed teal ring would read as a second, contradictory
                    // status color on a Failing/Degraded row.
                    isSelected ? "outline outline-1 -outline-offset-1 outline-ink" : ""
                  }`}
                >
                  <td className={`whitespace-nowrap px-3 py-2.5 font-display text-xs font-medium ${statusIdTextClasses[r.status]} ${statusAccentClasses[r.status]}${flash}`}>
                    {r.id}
                  </td>
                  <td className={`px-3 py-2.5 text-ink${flash}`}>{r.channel}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-ink-dim${flash}`}>{r.cdnProvider}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 font-display tabular-nums ${r.bitrateMbps < 3 ? "font-semibold text-alert" : "text-ink-dim"}${flash}`}>
                    {r.bitrateMbps.toFixed(1)}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2.5 font-display tabular-nums text-ink-dim${flash}`}>{r.fps}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 ${r.audioStatus !== "OK" ? "font-semibold text-alert" : "text-ink-dim"}${flash}`}>
                    {r.audioStatus}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2.5 ${r.subtitleSync !== "In Sync" ? "font-semibold text-alert" : "text-ink-dim"}${flash}`}>
                    {r.subtitleSync}
                  </td>
                  <td className={`px-3 py-2.5${flash}`}>
                    <div className="flex min-w-28 flex-wrap items-center gap-1.5">
                      <Badge className={statusBadgeClasses[r.status]}>
                        <span className={`size-1.5 rounded-full ${statusDotClasses[r.status]}`} />
                        {STATUS_LABELS[r.status]}
                      </Badge>
                      {isPending && <Badge className="border-line-bright bg-panel-2 text-ink-dim">Pending</Badge>}
                    </div>
                  </td>
                  <td className={`px-3 py-2.5${flash}`}>
                    <ChevronRight className="size-4 text-ink-faint" />
                  </td>
                </tr>
              );
            })}
            {visibleBatch.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-ink-faint">
                  No streams match the active filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
