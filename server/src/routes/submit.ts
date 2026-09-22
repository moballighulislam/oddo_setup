/**
 * POST /api/forms/:formId/submit — the only write endpoint the public site calls.
 *
 * Stage 1 and 2 of the pipeline (capture, validate) plus the storage write.
 * Everything slow — email, Slack, CRM push, geolocation, AI extraction — belongs
 * in the queue, not here. A downstream outage must never fail a form submit.
 *
 * Target: under ~200ms, dominated by the optional reCAPTCHA round trip.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FORM_IDS, type FormId } from '../schemas/enums.js';
import { FORM_SCHEMAS, normalise, requiresBusinessEmail } from '../schemas/forms.js';
import { HiddenFieldsSchema, stripServerOwned } from '../schemas/hidden.js';
import { checkSubmission, isFreeEmailDomain } from '../services/antibot.js';
import { persistSubmission } from '../services/persist.js';
import { clientIp, clientCountry, deviceFromUserAgent, userAgent } from '../lib/clientIp.js';
import { env } from '../env.js';

interface SubmitParams {
  formId: string;
}

export async function submitRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/forms/:formId/submit',
    {
      config: {
        rateLimit: {
          max: env.RATE_LIMIT_MAX,
          timeWindow: env.RATE_LIMIT_WINDOW,
        },
      },
    },
    async (req: FastifyRequest<{ Params: SubmitParams }>, reply: FastifyReply) => {
      const formId = req.params.formId as FormId;

      // ---- 1. Known template? --------------------------------------------
      if (!FORM_IDS.includes(formId)) {
        return reply.code(404).send({
          ok: false,
          error: 'unknown_form',
          message: `No such form template. Expected one of: ${FORM_IDS.join(', ')}`,
        });
      }

      // ---- 2. Parse the body ---------------------------------------------
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          ok: false,
          error: 'invalid_body',
          message: 'Request body must be a JSON object',
        });
      }

      // Drop anything the client must not be allowed to set — a score, a routing
      // tier, an assignee. Done before validation so passthrough() cannot let
      // them through into raw_payload as authoritative values.
      const cleaned = stripServerOwned(body as Record<string, unknown>);

      // ---- 3. Validate against the template's schema ----------------------
      const schema = FORM_SCHEMAS[formId];
      const parsed = schema.safeParse(cleaned);

      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: 'validation_failed',
          message: 'Some fields need attention',
          fields: parsed.error.flatten().fieldErrors,
        });
      }

      const data = normalise(formId, parsed.data);
      const hidden = HiddenFieldsSchema.parse(cleaned);

      // ---- 4. Business email check ---------------------------------------
      // Newsletter signup is exempt: an individual practitioner subscribing with a
      // personal address is a legitimate audience for a GRC blog.
      if (
        env.BLOCK_FREE_EMAIL_DOMAINS &&
        requiresBusinessEmail(formId) &&
        isFreeEmailDomain(data.email)
      ) {
        return reply.code(400).send({
          ok: false,
          error: 'personal_email',
          message: 'Please use your work email address',
          fields: { email: ['A business email address is required'] },
        });
      }

      const ip = clientIp(req);
      const ua = userAgent(req);

      // ---- 5. Anti-bot ----------------------------------------------------
      // The verdict is recorded on the row. A flagged submission is still stored
      // and still returns 200 — telling a bot it was detected only helps it.
      const verdict = await checkSubmission({
        honeypot: hidden.website,
        formRenderMs: hidden.form_render_ms,
        token: hidden.recaptcha_token,
        remoteIp: ip ?? undefined,
      });

      // ---- 6. Persist (idempotent on submission_uuid) ---------------------
      try {
        const result = await persistSubmission({
          formId,
          formName: parsed.data.form_name,
          submissionUuid: parsed.data.submission_uuid,
          data,
          hidden,
          rawPayload: cleaned,
          ipAddress: ip,
          userAgent: ua,
          geoCountry: clientCountry(req),
          deviceTypeFallback: deviceFromUserAgent(ua),
          isSuspectedBot: verdict.isSuspected,
          botReason: verdict.reason,
          recaptchaScore: verdict.score,
        });

        req.log.info(
          {
            formId,
            formName: parsed.data.form_name,
            submission: result.submissionPublicId,
            score: result.score,
            tier: result.routingTier,
            bot: verdict.isSuspected ? verdict.reason : undefined,
            duplicate: result.wasDuplicate || undefined,
          },
          'form submission stored',
        );

        // Layer 1 jobs (enrich, confirmation email, Slack, calendar, CRM push,
        // message parsing) were already enqueued inside the persist transaction —
        // see src/queue/dispatch.ts. Nothing slow happens on this thread.

        return reply.code(200).send({
          ok: true,
          submission_id: result.submissionPublicId,
          // Deliberately NOT returned: score, routing tier, assignee. That is
          // internal sales intelligence and the browser has no use for it.
        });
      } catch (err) {
        req.log.error({ err, formId }, 'failed to store submission');
        return reply.code(500).send({
          ok: false,
          error: 'storage_failed',
          message: 'Something went wrong on our end. Please try again.',
        });
      }
    },
  );
}
