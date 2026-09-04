import type { Transition } from "@/lib/grid-engine";
import type { DomainConfig } from "@/lib/domains/types";

export type CDNProvider = "US-East" | "US-West" | "EU-West" | "EU-Central" | "APAC-East";
export type AudioStatus = "OK" | "Muted" | "Desync" | "Encoder Error";
export type SubtitleSync = "In Sync" | "Drifting" | "Out of Sync" | "Missing";
export type StreamStatus = "Healthy" | "Degraded" | "Failing" | "Rerouted";

export type StreamRecord = {
  id: string;
  channel: string;
  cdnProvider: CDNProvider;
  bitrateMbps: number;
  fps: number;
  audioStatus: AudioStatus;
  subtitleSync: SubtitleSync;
  status: StreamStatus;
  statusFlags: string[];
  lastUpdated: string;
  failoverAvailable: boolean;
};

export type CinemaActionId = "switch_failover_cdn" | "restart_audio_encoder" | "resync_subtitles";

export const STATUS_LABELS: Record<StreamStatus, string> = {
  Healthy: "Healthy",
  Degraded: "Degraded",
  Failing: "Failing",
  Rerouted: "Healthy / Rerouted",
};

const FAILOVER_MAP: Record<CDNProvider, CDNProvider> = {
  "EU-West": "US-East",
  "EU-Central": "US-East",
  "US-East": "US-West",
  "US-West": "US-East",
  "APAC-East": "US-West",
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function deriveFlags(fields: Pick<StreamRecord, "bitrateMbps" | "audioStatus" | "subtitleSync">): string[] {
  const flags: string[] = [];
  if (fields.bitrateMbps < 3) flags.push("Low Bitrate");
  if (fields.audioStatus !== "OK") flags.push(`Audio: ${fields.audioStatus}`);
  if (fields.subtitleSync !== "In Sync") flags.push(`Subtitles: ${fields.subtitleSync}`);
  return flags;
}

function deriveStatus(flags: string[], bitrateMbps: number): StreamStatus {
  if (flags.length === 0) return "Healthy";
  if (bitrateMbps < 1.5 || flags.length >= 2) return "Failing";
  return "Degraded";
}

const CHANNELS = [
  "CineMax Prime — Feature Presentation",
  "GlobalSport 1 — Live Match",
  "StudioFeed 4K — Premiere Night",
  "NewsWire 24 — Live Desk",
  "IndieReel — Festival Selects",
  "DocuWorld — Live Broadcast",
  "ArenaLive — Championship Round",
  "KidsBeam — Saturday Block",
  "ConcertStage — Live Set",
  "GameCast — Tournament Finals",
];

const CDN_PROVIDERS: CDNProvider[] = ["US-East", "US-West", "EU-West", "EU-Central", "APAC-East"];

const rnd = (seed: number) => {
  const x = Math.sin(seed * 999.91) * 43758.5453;
  return x - Math.floor(x);
};

// Anchored to real wall-clock time so "last 24h"-style queries the agent
// constructs against `lastUpdated` stay meaningful whenever the app runs.
const NOW = Date.now();

export function generateStreams(count = 220): StreamRecord[] {
  const records: StreamRecord[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const provider = CDN_PROVIDERS[Math.floor(rnd(n) * CDN_PROVIDERS.length)];
    const isDegraded = rnd(n + 211) < 0.1;
    const bitrateMbps = isDegraded
      ? Math.round((1 + rnd(n + 31) * 2.5) * 10) / 10
      : Math.round((5 + rnd(n + 31) * 7) * 10) / 10;
    const audioStatus: AudioStatus =
      rnd(n + 52) < 0.1 ? (["Muted", "Desync", "Encoder Error"] as const)[Math.floor(rnd(n + 53) * 3)] : "OK";
    const subtitleSync: SubtitleSync =
      rnd(n + 74) < 0.1
        ? (["Drifting", "Out of Sync", "Missing"] as const)[Math.floor(rnd(n + 75) * 3)]
        : "In Sync";
    const flags = deriveFlags({ bitrateMbps, audioStatus, subtitleSync });
    return {
      id: `STREAM-CDN-${String(n).padStart(3, "0")}`,
      channel: CHANNELS[n % CHANNELS.length],
      cdnProvider: provider,
      bitrateMbps,
      fps: bitrateMbps < 3 ? [15, 24][n % 2] : [50, 60][n % 2],
      audioStatus,
      subtitleSync,
      status: deriveStatus(flags, bitrateMbps),
      statusFlags: flags,
      lastUpdated: new Date(NOW - Math.floor(rnd(n + 92) * 72 * 3600000)).toISOString(),
      failoverAvailable: rnd(n + 140) > 0.05,
    };
  });

  // Guaranteed, deterministic incident row for the headline demo scenario.
  const incident: StreamRecord = {
    id: "STREAM-CDN-804",
    channel: "ArenaLive — Championship Round",
    cdnProvider: "EU-West",
    bitrateMbps: 1.8,
    fps: 24,
    audioStatus: "Desync",
    subtitleSync: "Drifting",
    status: "Failing",
    statusFlags: deriveFlags({ bitrateMbps: 1.8, audioStatus: "Desync", subtitleSync: "Drifting" }),
    lastUpdated: new Date(NOW - 2 * 3600000).toISOString(),
    failoverAvailable: true,
  };
  // Placed at a fixed low index so it always sits in the first visible batch,
  // regardless of how a query happens to sort or slice the results.
  records[0] = incident;

  return records;
}

function restoredBitrate(id: string): number {
  return Math.round((6 + (hashString(id) % 35) / 10) * 10) / 10;
}

export function planCinemaAction(record: StreamRecord, action: CinemaActionId): Transition<StreamRecord, CinemaActionId> {
  const base = { recordId: record.id, action };

  if (action === "switch_failover_cdn") {
    if (record.bitrateMbps >= 3) {
      return { ...base, allowed: false, reason: "Bitrate is within the healthy range; failover is not required.", patch: {} };
    }
    if (!record.failoverAvailable) {
      return { ...base, allowed: false, reason: "No failover CDN is configured for this stream.", patch: {} };
    }
    const nextProvider = FAILOVER_MAP[record.cdnProvider];
    const nextBitrate = restoredBitrate(record.id);
    const merged = { ...record, cdnProvider: nextProvider, bitrateMbps: nextBitrate };
    const flags = deriveFlags(merged);
    return {
      ...base,
      allowed: true,
      reason: `Rerouted from ${record.cdnProvider} to ${nextProvider}; bitrate restored to ${nextBitrate.toFixed(1)} Mbps.`,
      patch: {
        cdnProvider: nextProvider,
        bitrateMbps: nextBitrate,
        statusFlags: flags,
        // "Rerouted" reports the CDN failover itself, independent of any other
        // flag (e.g. a lingering subtitle issue) the record may still carry.
        status: "Rerouted",
      },
    };
  }

  if (action === "restart_audio_encoder") {
    if (record.audioStatus === "OK") {
      return { ...base, allowed: false, reason: "Audio encoder is already healthy.", patch: {} };
    }
    const merged = { ...record, audioStatus: "OK" as const };
    const flags = deriveFlags(merged);
    return {
      ...base,
      allowed: true,
      reason: "Audio encoder restarted; audio status restored to OK.",
      patch: {
        audioStatus: "OK",
        statusFlags: flags,
        // Once a stream has been rerouted this session, keep reporting that —
        // don't let a later action's flag count silently downgrade it.
        status: record.status === "Rerouted" ? "Rerouted" : deriveStatus(flags, merged.bitrateMbps),
      },
    };
  }

  // resync_subtitles
  if (record.subtitleSync === "In Sync") {
    return { ...base, allowed: false, reason: "Subtitles are already in sync.", patch: {} };
  }
  const merged = { ...record, subtitleSync: "In Sync" as const };
  const flags = deriveFlags(merged);
  return {
    ...base,
    allowed: true,
    reason: "Subtitle track resynced.",
    patch: {
      subtitleSync: "In Sync",
      statusFlags: flags,
      status: record.status === "Rerouted" ? "Rerouted" : deriveStatus(flags, merged.bitrateMbps),
    },
  };
}

export const cinemaDomain: DomainConfig<StreamRecord, CinemaActionId> = {
  id: "media-streaming",
  name: "Media & Streaming",
  recordLabel: "stream",
  batchSize: 25,
  fields: [
    { key: "id", label: "Stream ID", type: "string" },
    { key: "channel", label: "Channel / Program", type: "string" },
    { key: "cdnProvider", label: "CDN Provider", type: "enum", enumValues: CDN_PROVIDERS },
    { key: "bitrateMbps", label: "Bitrate (Mbps)", type: "number" },
    { key: "fps", label: "FPS", type: "number" },
    { key: "audioStatus", label: "Audio Status", type: "enum", enumValues: ["OK", "Muted", "Desync", "Encoder Error"] },
    { key: "subtitleSync", label: "Subtitle Sync", type: "enum", enumValues: ["In Sync", "Drifting", "Out of Sync", "Missing"] },
    { key: "status", label: "Status", type: "enum", enumValues: ["Healthy", "Degraded", "Failing", "Rerouted"] },
    { key: "lastUpdated", label: "Last Updated", type: "date" },
  ],
  actions: [
    { id: "switch_failover_cdn", label: "Switch to Failover CDN", description: "Reroutes the stream to its configured failover CDN and restores bitrate." },
    { id: "restart_audio_encoder", label: "Restart Audio Encoder", description: "Restarts the audio encoder to clear mute/desync/encoder errors." },
    { id: "resync_subtitles", label: "Resync Subtitles", description: "Re-establishes subtitle timing sync with the video track." },
  ],
  generateRecords: generateStreams,
  planAction: planCinemaAction,
  examplePrompts: [
    "Show streams with bitrate below 3Mbps or audio/subtitle sync issues in the last 24h.",
    "Explain why the first visible stream matched.",
    "Preview switching the current visible batch to their failover CDN and restarting the audio encoder.",
    "I approve. Execute this preview.",
    "Undo the last batch action.",
  ],
};
