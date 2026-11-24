export function startSignalSchedule(interval: number, refresh: () => Promise<unknown>, onError: (error: unknown) => void) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }, interval);
  timer.unref?.();
  return timer;
}
