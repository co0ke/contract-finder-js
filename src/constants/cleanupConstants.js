export const CleanupConstants = Object.freeze({
  /** How long an advert can go unseen, or a run stay recorded, before the cleanup deletes it (ms). */
  RetentionMs: 21 * 24 * 60 * 60 * 1000,

  /** Daily at 03:30 UTC (NCRONTAB: second minute hour day month day-of-week). */
  Schedule: '0 30 3 * * *',

  /** The same time of day, for the standalone server's own scheduler. */
  ScheduleUtc: Object.freeze({ hour: 3, minute: 30 }),
});
