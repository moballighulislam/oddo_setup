/**
 * Database-backed job queue.
 *
 * This is the whole queue: enqueue, claim, complete, fail. Swapping to BullMQ later
 * means reimplementing this one file — nothing that calls `enqueue()` changes.
 *
 * Two properties are worth the polling cost:
 *
 *  1. A job enqueued inside the submit transaction commits atomically with the lead.
 *     If the process dies a millisecond after the response is sent, the job is still
 *     there. A Redis enqueue that happens after the database commit can be lost in
 *     exactly that window.
 *
 *  2. No extra infrastructure to run, deploy or monitor.
 *
 * The cost is latency (up to one poll interval) and no cross-process fan-out. At
 * marketing-form volume, neither binds.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { backoffMs, RETRY_POLICY, type JobType } from './types.js';

/**
 * How long a worker may hold a job before the lease is considered stale.
 * A worker killed mid-job leaves `lockedAt` set; without expiry that job is
 * stranded forever.
 */
const LEASE_MS = 5 * 60 * 1000;

/** Identifies which worker holds a lease. Useful when debugging a stuck job. */
const WORKER_ID = `${process.pid}-${ulid().slice(-6)}`;

export interface EnqueueOptions {
  /** Delay before the job becomes eligible to run. */
  delayMs?: number;
  /** Overrides the type's default retry budget. */
  maxAttempts?: number;
  /** For tracing a chain of jobs in the logs. */
  parentJobId?: string;
}

/**
 * Add a job.
 *
 * Accepts an optional transaction client so callers can enqueue inside the same
 * transaction that writes the lead — that atomicity is the main reason this queue
 * lives in the database at all.
 */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
  tx?: Prisma.TransactionClient | PrismaClient,
): Promise<string> {
  const client = tx ?? prisma;
  const jobId = ulid();

  await client.job.create({
    data: {
      jobId,
      type,
      payload: JSON.stringify(payload),
      status: 'pending',
      maxAttempts: options.maxAttempts ?? RETRY_POLICY[type].maxAttempts,
      runAt: new Date(Date.now() + (options.delayMs ?? 0)),
      parentJobId: options.parentJobId ?? null,
    },
  });

  return jobId;
}

/** Enqueue several jobs in one call. Order is not significant. */
export async function enqueueMany(
  jobs: Array<{ type: JobType; payload: Record<string, unknown>; options?: EnqueueOptions }>,
  tx?: Prisma.TransactionClient | PrismaClient,
): Promise<string[]> {
  const ids: string[] = [];
  for (const job of jobs) {
    ids.push(await enqueue(job.type, job.payload, job.options ?? {}, tx));
  }
  return ids;
}

export interface ClaimedJob {
  id: number;
  jobId: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Claim up to `limit` runnable jobs.
 *
 * Claiming is a two-step read-then-lock inside a transaction. The lock write is
 * conditional on the row still being unclaimed, so if two workers race, the second
 * one's update matches zero rows and it simply skips that job. That conditional
 * update — not the transaction — is what makes this safe.
 *
 * Eligible means: pending (or previously failed with retries left), due to run, and
 * either unlocked or holding an expired lease.
 */
export async function claimJobs(limit = 5): Promise<ClaimedJob[]> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LEASE_MS);

  const candidates = await prisma.job.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
      runAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    orderBy: { runAt: 'asc' },
    take: limit,
    select: { id: true, jobId: true, type: true, payload: true, attempts: true, maxAttempts: true },
  });

  const claimed: ClaimedJob[] = [];

  for (const candidate of candidates) {
    const result = await prisma.job.updateMany({
      where: {
        id: candidate.id,
        // Re-assert eligibility. Another worker may have taken it since the read.
        status: { in: ['pending', 'failed'] },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      data: {
        status: 'running',
        lockedAt: now,
        lockedBy: WORKER_ID,
        attempts: { increment: 1 },
      },
    });

    if (result.count === 0) continue; // lost the race

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(candidate.payload) as Record<string, unknown>;
    } catch (err) {
      // Unparseable payload will never succeed. Retrying is pointless.
      logger.error({ err, jobId: candidate.jobId }, 'job payload is not valid JSON — killing');
      await killJob(candidate.id, 'payload is not valid JSON');
      continue;
    }

    claimed.push({
      id: candidate.id,
      jobId: candidate.jobId,
      type: candidate.type as JobType,
      payload,
      attempts: candidate.attempts + 1,
      maxAttempts: candidate.maxAttempts,
    });
  }

  return claimed;
}

export async function completeJob(id: number): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: {
      status: 'succeeded',
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/**
 * Record a failure.
 *
 * Reschedules with exponential backoff while attempts remain, and moves the job to
 * `dead` once the budget is exhausted. Dead jobs stay in the table on purpose —
 * they are the queue's error log, and deleting them hides exactly the failures
 * someone needs to see.
 */
export async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    logger.error(
      { jobId: job.jobId, type: job.type, attempts: job.attempts, error: message },
      'job dead — retry budget exhausted',
    );

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'dead',
        lastError: message.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        completedAt: new Date(),
      },
    });
    return;
  }

  const delay = backoffMs(job.type, job.attempts);

  logger.warn(
    { jobId: job.jobId, type: job.type, attempt: job.attempts, retryInMs: delay, error: message },
    'job failed — will retry',
  );

  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'failed',
      lastError: message.slice(0, 2000),
      runAt: new Date(Date.now() + delay),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

/** Mark a job unrecoverable without consuming its retry budget. */
async function killJob(id: number, reason: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: {
      status: 'dead',
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
      completedAt: new Date(),
    },
  });
}

/** Queue depth by status. Feeds /health and anything that alerts on a backlog. */
export async function queueStats(): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({ by: ['status'], _count: { status: true } });
  const stats: Record<string, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  };
  for (const row of rows) stats[row.status] = row._count.status;
  return stats;
}

/**
 * Delete succeeded jobs older than the retention window.
 *
 * Only `succeeded` rows are removed. Dead jobs are kept regardless of age —
 * they are the record of what broke.
 */
export async function pruneCompletedJobs(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.job.deleteMany({
    where: { status: 'succeeded', completedAt: { lt: cutoff } },
  });
  return result.count;
}
