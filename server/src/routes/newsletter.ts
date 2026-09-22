/**
 * Newsletter unsubscribe.
 *
 * Legally required, and required to be easy. Two rules shape this file:
 *
 *  1. An unsubscribe must never fail from the user's point of view. An unknown or
 *     already-used token still returns success — telling someone "that link is
 *     invalid" when they are trying to leave is both hostile and a compliance risk.
 *
 *  2. Unsubscribing sets status on the subscriber record. It never deletes the
 *     lead. Someone can opt out of marketing email and remain an active sales
 *     opportunity, and the suppression record must outlive the lead anyway.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';

const TokenSchema = z.object({
  token: z.string().min(10).max(128),
});

export async function newsletterRoutes(app: FastifyInstance): Promise<void> {
  /**
   * One-click unsubscribe target for the link in an email footer.
   * GET so it works from a mail client without JavaScript.
   */
  app.get(
    '/api/newsletter/unsubscribe',
    async (req: FastifyRequest<{ Querystring: { token?: string } }>, reply) => {
      const parsed = TokenSchema.safeParse(req.query);

      if (!parsed.success) {
        return reply.redirect(`${env.PUBLIC_APP_URL}/unsubscribe?status=invalid`);
      }

      await unsubscribeByToken(parsed.data.token, req.log);

      // Always reports success — see rule 1.
      return reply.redirect(`${env.PUBLIC_APP_URL}/unsubscribe?status=done`);
    },
  );

  /** JSON variant, for an in-page preference centre. */
  app.post(
    '/api/newsletter/unsubscribe',
    async (req: FastifyRequest<{ Body: { token?: string } }>, reply) => {
      const parsed = TokenSchema.safeParse(req.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_token',
          message: 'Unsubscribe token is missing or malformed',
        });
      }

      await unsubscribeByToken(parsed.data.token, req.log);

      return reply.code(200).send({
        ok: true,
        message: 'You have been unsubscribed.',
      });
    },
  );

  /**
   * Resubscribe. Deliberately requires the same token — the only person who can
   * undo an unsubscribe is whoever holds the link from their own email.
   */
  app.post(
    '/api/newsletter/resubscribe',
    async (req: FastifyRequest<{ Body: { token?: string } }>, reply) => {
      const parsed = TokenSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'invalid_token' });
      }

      const subscriber = await prisma.newsletterSubscriber.findUnique({
        where: { unsubscribeToken: parsed.data.token },
      });

      // A hard bounce or a spam complaint is not reversible by a link click.
      // Re-mailing a complained address damages sending reputation for everyone.
      if (!subscriber || subscriber.status === 'complained' || subscriber.status === 'bounced') {
        return reply.code(200).send({ ok: true, message: 'No change made.' });
      }

      await prisma.newsletterSubscriber.update({
        where: { id: subscriber.id },
        data: { status: 'subscribed', unsubscribedAt: null },
      });

      return reply.code(200).send({ ok: true, message: 'Resubscribed.' });
    },
  );
}

async function unsubscribeByToken(
  token: string,
  log: { info: (o: object, m: string) => void },
): Promise<void> {
  const result = await prisma.newsletterSubscriber.updateMany({
    where: { unsubscribeToken: token, status: 'subscribed' },
    data: { status: 'unsubscribed', unsubscribedAt: new Date() },
  });

  log.info({ matched: result.count }, 'unsubscribe processed');
}
