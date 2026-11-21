/**
 * Loads the four valid synthetic samples into the local database, so the app is ready to analyse.
 *
 * Uses the same services as the upload route: validateUpload, the documents repo, the buffer store and
 * the document processor. There is no raw SQL here. Processing runs in-process and finishes before the
 * script exits, so the rows are already `processed` when the server reads them.
 *
 * Idempotent: a sample whose file name is already in the database is skipped.
 * Run with: npm run seed (after npm run samples:generate)
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/src/config/env.js';
import { openDatabase } from '../server/src/db/client.js';
import { createDocumentsRepo } from '../server/src/db/repositories/documentsRepo.js';
import { createDocumentProcessor } from '../server/src/processing/index.js';
import { createBufferStore } from '../server/src/storage/bufferStore.js';
import { validateUpload } from '../server/src/upload/validation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(here, '..', 'samples');

/** The four valid samples. The invalid ones are only for the error demo and are not seeded. */
const SEED_FILES: ReadonlyArray<{ name: string; mimeType: string }> = [
  { name: 'application_form.pdf', mimeType: 'application/pdf' },
  { name: 'supporting_letter.txt', mimeType: 'text/plain' },
  { name: 'financials_fy2025.csv', mimeType: 'text/csv' },
  { name: 'kyc_summary.txt', mimeType: 'text/plain' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.DB_PATH);
  const documents = createDocumentsRepo(db);
  const buffers = createBufferStore({ ttlMs: config.BUFFER_TTL_MINUTES * 60_000, sweepIntervalMs: 0 });
  const processor = createDocumentProcessor({
    documents,
    buffers,
    options: {
      maxChars: config.MAX_CHARS_PER_DOCUMENT,
      timeoutMs: config.PROCESSING_TIMEOUT_MS,
      concurrency: config.PROCESSING_CONCURRENCY,
    },
  });

  const existingNames = new Set(documents.list().map((doc) => doc.originalName));
  let failures = 0;

  try {
    for (const sample of SEED_FILES) {
      if (existingNames.has(sample.name)) {
        console.log(`skipped   ${sample.name} (already in the database)`);
        continue;
      }

      const buffer = fs.readFileSync(path.join(SAMPLES_DIR, sample.name));
      const result = validateUpload(
        { originalName: sample.name, declaredMimeType: sample.mimeType, buffer },
        { id: randomUUID(), createdAt: new Date().toISOString() },
      );
      documents.insert(result.meta, null);

      if (!result.ok) {
        failures += 1;
        console.log(`rejected  ${sample.name}: ${result.reason}`);
        continue;
      }

      buffers.put(result.meta.id, buffer);
      await processor.processNow(result.meta.id);

      const record = documents.getById(result.meta.id);
      if (record?.status === 'processed') {
        console.log(`processed ${sample.name} (${record.charCount} chars)`);
      } else {
        failures += 1;
        console.log(`${record?.status ?? 'missing'}  ${sample.name}: ${record?.errorMessage ?? 'no message'}`);
      }
    }
  } finally {
    buffers.close();
    db.close();
  }

  if (failures > 0) {
    process.exitCode = 1;
    console.error(`${failures} sample(s) did not process. See the messages above.`);
  } else {
    console.log(`Seed complete. Database: ${config.DB_PATH}`);
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
