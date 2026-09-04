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
