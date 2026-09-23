/**
 * Creates the custom fields on Odoo's `crm.lead` model.
 *
 * Run once, with ADMIN credentials — creating fields writes to `ir.model.fields`,
 * which the normal integration user (CRM: User) cannot touch. That separation is
 * deliberate: the day-to-day key should not be able to alter the schema.
 *
 *   ODOO_ADMIN_USERNAME=you@example.com \
 *   ODOO_ADMIN_API_KEY=xxx \
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/odoo-create-fields.ts
 *
 * Flags:
 *   --dry-run   print what would happen, change nothing
 *   --delete    remove every field this script manages (destructive, asks first)
 *
 * Idempotent: existing fields are skipped, so re-running after adding a definition
 * only creates the new ones.
 *
 * Delete the admin API key once this has run. It has no further purpose.
 */
import { ALL_FIELDS, LAYER_1, LAYER_2, LAYER_3, type FieldDef } from './odoo-fields.js';

const URL = (process.env.ODOO_URL ?? '').replace(/\/$/, '');
const DB = process.env.ODOO_DB ?? '';
const USER = process.env.ODOO_ADMIN_USERNAME ?? process.env.ODOO_USERNAME ?? '';
const KEY = process.env.ODOO_ADMIN_API_KEY ?? process.env.ODOO_API_KEY ?? '';

const DRY_RUN = process.argv.includes('--dry-run');
const DELETE = process.argv.includes('--delete');

if (!URL || !DB || !USER || !KEY) {
  console.error('Missing ODOO_URL, ODOO_DB, ODOO_ADMIN_USERNAME or ODOO_ADMIN_API_KEY.');
  process.exit(1);
}

async function rpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
  const res = await fetch(`${URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { message?: string; data?: { message?: string } };
  };
  // Odoo reports application errors inside a 200 response.
  if (body.error) throw new Error(body.error.data?.message ?? body.error.message ?? 'Odoo error');
  return body.result as T;
}

let uid: number;
const ex = <T>(model: string, method: string, args: unknown[] = [], kwargs = {}): Promise<T> =>
  rpc<T>('object', 'execute_kw', [DB, uid, KEY, model, method, args, kwargs]);

/** Build the create payload for one field definition. */
function payload(def: FieldDef, modelId: number): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: def.name,
    model_id: modelId,
    field_description: def.label,
    ttype: def.type,
    // Required for custom fields — without it Odoo treats this as a base field.
    state: 'manual',
    ...(def.help ? { help: def.help } : {}),
  };

  if (def.type === 'selection') {
    if (!def.options?.length) throw new Error(`${def.name}: selection field has no options`);
    values.selection_ids = def.options.map(([value, label], i) => [
      0,
      0,
      { value, name: label, sequence: i + 1 },
    ]);
  }

  return values;
}

async function main(): Promise<void> {
  const loginResult = await rpc<number | false>('common', 'login', [DB, USER, KEY]);
  if (!loginResult) {
    throw new Error(
      'Authentication failed. Check ODOO_DB, ODOO_ADMIN_USERNAME and ODOO_ADMIN_API_KEY — ' +
        'and that the key scope is RPC, not MCP.',
    );
  }
  uid = loginResult;
  console.log(`Connected to ${URL} as uid ${uid}\n`);

  const models = await ex<Array<{ id: number }>>(
    'ir.model',
    'search_read',
    [[['model', '=', 'crm.lead']]],
    { fields: ['id'], limit: 1 },
  );
  const modelId = models[0]?.id;
  if (!modelId) throw new Error('crm.lead model not found — is the CRM app installed?');

  // What already exists, so re-running is safe.
  const existing = await ex<Array<{ id: number; name: string }>>(
    'ir.model.fields',
    'search_read',
    [
      [
        ['model_id', '=', modelId],
        ['name', 'in', ALL_FIELDS.map((f) => f.name)],
      ],
    ],
    { fields: ['id', 'name'] },
  );
  const existingByName = new Map(existing.map((f) => [f.name, f.id]));

  // ---- delete mode -------------------------------------------------------
  if (DELETE) {
    if (existing.length === 0) {
      console.log('Nothing to delete.');
      return;
    }
    console.log(`About to DELETE ${existing.length} fields and all data in them.`);
    if (DRY_RUN) {
      console.log('(dry run — nothing removed)');
      return;
    }
    if (process.env.CONFIRM_DELETE !== 'yes') {
      console.log('Refusing without CONFIRM_DELETE=yes. This destroys data.');
      process.exit(1);
    }
    await ex('ir.model.fields', 'unlink', [existing.map((f) => f.id)]);
    console.log('Deleted.');
    return;
  }

  // ---- create ------------------------------------------------------------
  let created = 0;
  let skipped = 0;
  const failed: Array<{ name: string; error: string }> = [];

  for (const [layerName, fields] of [
    ['Layer 1 — captured by the website', LAYER_1],
    ['Layer 2 — qualification', LAYER_2],
    ['Layer 3 — deal', LAYER_3],
  ] as const) {
    console.log(`\n${layerName}`);
    console.log('-'.repeat(layerName.length));

    for (const def of fields) {
      if (existingByName.has(def.name)) {
        console.log(`  = ${def.name.padEnd(26)} already exists`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  + ${def.name.padEnd(26)} ${def.type}${def.report ? '  [report]' : ''}`);
        created++;
        continue;
      }

      try {
        await ex<number>('ir.model.fields', 'create', [payload(def, modelId)]);
        console.log(`  + ${def.name.padEnd(26)} ${def.type}${def.report ? '  [report]' : ''}`);
        created++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ! ${def.name.padEnd(26)} FAILED — ${message.split('\n')[0]}`);
        failed.push({ name: def.name, error: message });
      }
    }
  }

  console.log(
    `\n${DRY_RUN ? 'Would create' : 'Created'} ${created}, skipped ${skipped}, failed ${failed.length}`,
  );

  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ${f.name}: ${f.error.split('\n')[0]}`);
    process.exit(1);
  }

  if (!DRY_RUN) {
    console.log('\nNext: arrange these in the Odoo form and list views (guide 12).');
    console.log('Then delete the admin API key — it has no further purpose.');
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
