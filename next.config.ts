import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
