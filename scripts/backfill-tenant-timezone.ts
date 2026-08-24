/**
 * Story 9.1 / AD-30 — Backfill one-shot de `tenant_configs.zonaHoraria`.
 *
 * Idempotente: solo setea America/Mexico_City donde el campo falta o está vacío.
 * NO corre en onModuleInit.
 *
 * Uso:
 *   cd backend
 *   npm run migrate:tenant-timezone
 *
 * Requiere MONGODB_URI (igual que la app). Ver scripts/README-backfill-tenant-timezone.md
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';

const DEFAULT_ZONE = 'America/Mexico_City';

/** Carga backend/.env sin dependencia directa de dotenv. */
function loadEnvFile() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri?.trim()) {
    console.error('ERROR: MONGODB_URI no definida. Configura backend/.env');
    process.exit(1);
  }

  console.log('Conectando a Mongo…');
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('sin database handle tras mongoose.connect');
    }

    const col = db.collection('tenant_configs');
    const filter = {
      $or: [
        { zonaHoraria: { $exists: false } },
        { zonaHoraria: null },
        { zonaHoraria: '' },
        // Solo-whitespace: el service hace trim/fallback; el script no debe dejar basura.
        { zonaHoraria: { $regex: /^\s+$/ } },
      ],
    };

    const pending = await col.countDocuments(filter);
    const result = await col.updateMany(filter, {
      $set: { zonaHoraria: DEFAULT_ZONE },
    });

    const withZone = await col.countDocuments({
      zonaHoraria: { $type: 'string', $ne: '' },
    });

    console.log('\n=== Backfill TZ OK ===');
    console.log(`Pendientes antes: ${pending}`);
    console.log(`matched: ${result.matchedCount}`);
    console.log(`modified: ${result.modifiedCount}`);
    console.log(`Configs con zonaHoraria no vacía: ${withZone}`);
    console.log(`Default aplicado: ${DEFAULT_ZONE}`);
    console.log('\nRe-run es seguro (idempotente).');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\nBackfill FALLIDO:', err?.message || err);
  process.exit(1);
});
