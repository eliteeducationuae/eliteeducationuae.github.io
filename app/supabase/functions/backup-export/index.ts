// Nightly backup of the business records to the private 'backups' storage bucket (service role only).
// Schedule daily at 22:10 UTC (02:10 UAE) with Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
// Writes <YYYY-MM-DD>/<table>.json for each table in BACKUP_TABLES (UAE date; tables missing from the database are
// skipped) and <YYYY-MM-DD>/manifest.json (row counts, database version, time), then deletes folders older than 35 days.
// Never exports calendar tokens, OAuth states, tutor bank details, autopay requests or push tokens.
// This complements Supabase's own database backups: it is a readable copy of the business records, from which single
// tables or rows can be restored. It is not a full backup (no auth users, storage files or secrets); point-in-time
// recovery or Supabase's daily backups are the way to restore the whole database.
// Returns { folder, tables, rows, deleted }.
import { adminClient, json } from '../_shared/supabase.ts';
import { BACKUP_TABLES, backupPrefix, expiredBackupPrefixes, withMonitoring } from '../_shared/monitoring.ts';

const BUCKET = 'backups';
const PAGE = 1000;

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when PostgREST says the table is not there (a later migration not applied yet). */
function missingTable(error: { code?: string; message?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '');
}

Deno.serve(withMonitoring('backup-export', adminClient, async (req) => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) {
    return json({ error: 'Only the schedule can run backups.' }, 403);
  }
  const db = adminClient();
  const now = new Date();
  const folder = backupPrefix(now);
  const counts: Record<string, number> = {};
  const skipped: string[] = [];

  for (const { table, columns, orderBy } of BACKUP_TABLES) {
    const rows: unknown[] = [];
    let missing = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + PAGE - 1);
      if (error) {
        if (missingTable(error)) {
          missing = true;
          break;
        }
        throw new Error(`Reading ${table} failed: ${error.message}`);
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (missing) {
      skipped.push(table);
      continue;
    }
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(`${folder}${table}.json`, new Blob([JSON.stringify(rows)], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadError) throw new Error(`Saving ${table} failed: ${uploadError.message}`);
    counts[table] = rows.length;
  }

  const { data: versions } = await db.rpc('db_version');
  const latest = ((versions ?? []) as { version: string; name: string | null }[]).sort((a, b) => b.version.localeCompare(a.version))[0];
  const manifest = {
    format: 'elite-education-backup/1',
    createdAt: now.toISOString(),
    folder,
    database: { latest: latest?.version ?? null, latestName: latest?.name ?? null },
    tables: counts,
    skipped,
  };
  const { error: manifestError } = await db.storage
    .from(BUCKET)
    .upload(`${folder}manifest.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), {
      contentType: 'application/json',
      upsert: true,
    });
  if (manifestError) throw new Error(`Saving the manifest failed: ${manifestError.message}`);

  // Keep 35 days of backups.
  let deleted = 0;
  const { data: top } = await db.storage.from(BUCKET).list('', { limit: 1000 });
  for (const prefix of expiredBackupPrefixes((top ?? []).map((f) => f.name), now)) {
    const name = prefix.replace(/\/$/, '');
    const { data: files } = await db.storage.from(BUCKET).list(name, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${name}/${f.name}`);
    if (paths.length) {
      const { error } = await db.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`Removing the backup of ${name} failed: ${error.message}`);
      deleted++;
    }
  }

  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  return json({ folder, tables: Object.keys(counts).length, rows, deleted });
}));
