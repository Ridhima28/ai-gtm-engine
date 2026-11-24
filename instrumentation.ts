declare global {
  var atlasSignalSchedule: ReturnType<typeof setInterval> | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.ATLAS_SIGNAL_REFRESH_DISABLED === "1" || globalThis.atlasSignalSchedule) return;

  const { graphCredentialsAvailable, graphFailure } = await import("./app/lib/neo4j-graph");
  if (!graphCredentialsAvailable() || !process.env.TAVILY_API_KEY?.trim()) return;
  const { refreshSignals, signalRefreshInterval } = await import("./app/lib/graph-signal-refresh");
  const { startSignalSchedule } = await import("./app/lib/signal-schedule");
  globalThis.atlasSignalSchedule ??= startSignalSchedule(signalRefreshInterval(), refreshSignals, (error) => {
    graphFailure("scheduled_signal_refresh", error);
  });
}
