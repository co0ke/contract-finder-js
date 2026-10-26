const MsPerDay = 24 * 60 * 60 * 1000;

/**
 * Runs `task` every day at the given UTC time: the standalone server's stand-in for the timer trigger.
 * @param {{ hour: number, minute: number }} at
 * @param {() => Promise<void>} task
 * @param {{ now?: () => Date, logger?: import('./services/logger.js').Logger }} [options]
 * @returns {() => void} Stops the schedule.
 */
export function scheduleDailyUtc(at, task, { now = () => new Date(), logger = console } = {}) {
  let timer = null;

  const schedule = () => {
    const current = now();
    let next = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), at.hour, at.minute);
    if (next <= current.getTime()) {
      next += MsPerDay;
    }
    timer = setTimeout(async () => {
      try {
        await task();
      } catch (error) {
        logger.error('Scheduled task threw', error);
      }
      schedule();
    }, next - current.getTime());
    timer.unref();
  };

  schedule();
  return () => clearTimeout(timer);
}
