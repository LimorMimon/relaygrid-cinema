# Vendored `mcp-grafana` (Linux x86_64)

Why this is committed to the repo (unlike `.mcp-grafana/`, which is git-ignored and holds
the Windows binary for local dev): Vercel's serverless functions run on Linux, and Next.js's
build-time file tracing only bundles files it can see referenced from source — a binary
spawned via a runtime filesystem path needs to actually exist in the repo (or be explicitly
traced in via `next.config.ts`) to make it into the deployed function at all. `lib/partner-mcp.ts`
picks this binary specifically when `process.env.VERCEL` is set (i.e. running on Vercel,
any environment), and falls back to the git-ignored `.mcp-grafana/mcp-grafana.exe` locally.

- **Source:** https://github.com/grafana/mcp-grafana/releases/tag/v1.3.0 (asset
  `mcp-grafana_Linux_x86_64.tar.gz`), sha256 verified against the release's own
  `checksums.txt` before extracting.
- **License:** Apache 2.0 (see `LICENSE` in this folder) — the binary is redistributed as
  built by Grafana Labs, unmodified.
- Re-download and re-verify the checksum when bumping the version; don't just overwrite this
  binary from an unverified source.
