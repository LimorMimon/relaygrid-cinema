import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @modelcontextprotocol/sdk's stdio transport (used to spawn mcp-clickhouse
  // — lib/partner-mcp.ts) needs Node's real child_process/fs, which breaks
  // when webpack tries to bundle it for the edge runtime — instrumentation.ts
  // gets compiled for both runtimes even though its own register() only
  // ever executes the nodejs branch. Marking it external tells Next.js to
  // require() it directly instead of bundling it, sidestepping the edge
  // build entirely for this package.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // The vendored Linux mcp-grafana binary (vendor/mcp-grafana-linux-x64/,
  // spawned by lib/partner-mcp.ts's GrafanaPartnerMcpClient) is only ever
  // referenced via a runtime fs/child_process path, not a static import —
  // Next's build-time file tracing can't see that on its own, so every API
  // route that transitively imports lib/partner-mcp.ts needs it listed here
  // explicitly, or the binary silently isn't in the deployed function at all.
  outputFileTracingIncludes: {
    "/api/agent": ["./vendor/mcp-grafana-linux-x64/**"],
    "/api/sponsor-ingest": ["./vendor/mcp-grafana-linux-x64/**"],
    "/api/partner-warmup": ["./vendor/mcp-grafana-linux-x64/**"],
    "/api/partner-info": ["./vendor/mcp-grafana-linux-x64/**"],
  },
  async headers() {
    return [
      {
        // WebMCP (document.modelContext) is only exposed to origin-isolated documents.
        source: "/:path*",
        headers: [
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "Permissions-Policy", value: "tools=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
