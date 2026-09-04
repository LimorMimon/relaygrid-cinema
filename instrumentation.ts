/**
 * Runs when the Next.js server process starts — see
 * https://nextjs.org/docs/app/guides/instrumentation.
 *
 * Used here to eagerly warm up the configured partner MCP connection
 * (lib/partner-mcp.ts) at boot, instead of on whatever request happens to
 * be first. A cold ClickHouse Cloud connection can take up to ~30s to
 * establish or time out (observed live, mid-demo) — paying that cost once
 * at server startup, not on a judge's first click, is the entire point.
 *
 * Two things this deliberately avoids, both confirmed live:
 *   1. Importing lib/partner-mcp.ts directly from this file. Next.js
 *      compiles instrumentation.ts for both the nodejs AND edge runtimes
 *      even though register() only ever executes its nodejs branch, and
 *      that edge compilation pass fails outright on partner-mcp.ts's
 *      transitive child_process import ("Module not found: Can't resolve
 *      'child_process'", every route 500ing). Routing the actual warm-up
 *      through an ordinary `runtime = "nodejs"` API route
 *      (app/api/partner-warmup/route.ts) sidesteps that — this file's only
 *      import is a JS global (fetch).
 *   2. Awaiting that warm-up inside register() itself. Next.js doesn't
 *      finish booting — doesn't start accepting connections — until
 *      register() resolves, so awaiting a self-fetch here deadlocks the
 *      server against itself (the fetch can never succeed because nothing
 *      is listening yet, and nothing will ever listen because register()
 *      never returns). Firing it off without awaiting lets the server
 *      finish booting immediately; the warm-up then polls in the
 *      background until the listener is actually up.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  void warmUpPartnerConnection();
}

async function warmUpPartnerConnection(): Promise<void> {
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/partner-warmup`;

  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (res.ok) {
        console.log("[instrumentation] Partner MCP warm-up:", body);
      } else {
        console.warn("[instrumentation] Partner MCP warm-up failed:", body ?? res.status);
      }
      return;
    } catch {
      // Listener likely isn't up yet on the first couple of attempts — keep retrying.
    }
  }
  console.warn("[instrumentation] Partner MCP warm-up route never became reachable — the first real request will pay the cold-start cost instead.");
}
