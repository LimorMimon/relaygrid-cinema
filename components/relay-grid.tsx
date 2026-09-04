"use client";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type StreamRecord } from "@/lib/domains/cinema";

const statusRowClasses: Record<StreamRecord["status"], string> = {
  Healthy: "hover:bg-panel-2",
  Degraded: "bg-caution-soft/70 hover:bg-caution-soft/90",
  Failing: "bg-alert-soft/70 hover:bg-alert-soft/90",
  Rerouted: "bg-signal-soft/70 hover:bg-signal-soft/90",
  "Auto-Resolved": "bg-auto-soft/70 hover:bg-auto-soft/90",
};
/** Applied to the first `<td>` only — a left border on `<tr>` itself renders unreliably under border-collapse. */
const statusAccentClasses: Record<StreamRecord["status"], string> = {
  Healthy: "border-l-2 border-transparent",
  Degraded: "border-l-2 border-caution",
  Failing: "border-l-2 border-alert",
  Rerouted: "border-l-2 border-signal",
  "Auto-Resolved": "border-l-2 border-auto",
};
const statusIdTextClasses: Record<StreamRecord["status"], string> = {
  Healthy: "text-signal",
  Degraded: "text-caution",
  Failing: "text-alert",
  Rerouted: "text-signal",
  "Auto-Resolved": "text-auto",
};
const statusBadgeClasses: Record<StreamRecord["status"], string> = {
  Healthy: "border-line-bright bg-panel-2 text-ink-dim",
  Degraded: "border-caution/40 bg-caution-soft text-caution",
  Failing: "border-alert/40 bg-alert-soft text-alert",
  Rerouted: "border-signal/40 bg-signal-soft text-signal",
  "Auto-Resolved": "border-auto/40 bg-auto-soft text-auto",
};
const statusDotClasses: Record<StreamRecord["status"], string> = {
  Healthy: "bg-ink-faint",
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
    <div className="overflow-hidden rounded border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line bg-panel-2 px-4 py-2.5">
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-ink">
          {totalMatches === totalRecords
            ? `${totalRecords.toLocaleString()} streams`
            : `${totalMatches.toLocaleString()} of ${totalRecords.toLocaleString()} streams`}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Showing {visibleBatch.length.toLocaleString()} · {Math.max(0, totalMatches - visibleBatch.length).toLocaleString()} more
          match
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <thead className="border-b border-line bg-void-2 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
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
                    isSelected ? "outline outline-1 -outline-offset-1 outline-signal" : ""
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
