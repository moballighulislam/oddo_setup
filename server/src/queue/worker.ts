/**
 * Worker loop.
 *
 * Polls for due jobs, runs them with a timeout, and reports the outcome back to the
 * driver. Runs either in-process alongside the API (default, simplest to operate) or
 * as its own process via `npm run worker`.
 */
import { claimJobs, completeJob, failJob, pruneCompletedJobs } from './driver.js';
import { HANDLERS } from './handlers.js';
import { logger } from '../lib/logger.js';

export interface WorkerOptions {
  /** Gap between polls when the queue is empty. */
  pollIntervalMs?: number;
  /** Jobs claimed per poll. */
  batchSize?: number;
  /** Hard ceiling on a single job. */
  jobTimeoutMs?: number;
}

const DEFAULTS: Required<WorkerOptions> = {
  pollIntervalMs: 2000,
  batchSize: 5,
  jobTimeoutMs: 30_000,
};

export class Worker {
  private readonly options: Required<WorkerOptions>;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  /** Tracks the active tick so shutdown can wait for in-flight jobs. */
  private activeTick: Promise<void> | null = null;

  constructor(options: WorkerOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ ...this.options }, 'worker started');
    this.scheduleNext(0);
  }

  /** Stops polling and waits for the current tick to finish. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activeTick) await this.activeTick;
    logger.info('worker stopped');
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.activeTick = this.tick()
        .catch((err) => logger.error({ err }, 'worker tick failed'))
        .finally(() => {
          this.activeTick = null;
          // Poll immediately after a full batch — a backlog should drain at speed
          // rather than one batch per interval.
          this.scheduleNext(this.lastBatchWasFull ? 0 : this.options.pollIntervalMs);
        });
    }, delayMs);
  }

  private lastBatchWasFull = false;

  private async tick(): Promise<void> {
    const jobs = await claimJobs(this.options.batchSize);
    this.lastBatchWasFull = jobs.length === this.options.batchSize;

    if (jobs.length === 0) return;

    // Sequential rather than parallel: SQLite serialises writes anyway, and this
    // keeps the failure mode simple. Revisit when the database moves to MySQL.
    for (const job of jobs) {
      const started = Date.now();

      try {
        const handler = HANDLERS[job.type];
        if (!handler) throw new Error(`no handler registered for job type "${job.type}"`);

        await withTimeout(
          handler(job.payload, job.jobId),
          this.options.jobTimeoutMs,
          `job ${job.type} exceeded ${this.options.jobTimeoutMs}ms`,
        );

        await completeJob(job.id);
        logger.debug(
          { jobId: job.jobId, type: job.type, ms: Date.now() - started },
          'job succeeded',
        );
      } catch (err) {
        await failJob(job, err);
      }
    }
  }
}

/**
 * Reject once a promise exceeds its budget.
 *
 * The underlying work is not cancelled — it cannot be — but the worker slot is
 * freed. Without this, one hung fetch stalls the queue indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Periodic cleanup of succeeded jobs. Dead jobs are never pruned — they are the
 * record of what broke.
 */
export function startJobPruner(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    pruneCompletedJobs(7)
      .then((count) => {
        if (count > 0) logger.info({ count }, 'pruned completed jobs');
      })
      .catch((err) => logger.error({ err }, 'job pruning failed'));
  }, intervalMs);

  timer.unref(); // must not keep the process alive
  return timer;
}
