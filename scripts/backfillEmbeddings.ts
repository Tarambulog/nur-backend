#!/usr/bin/env tsx
// ─── Backfill Embeddings ────────────────────────────────────────────────────
//
// One-time (or per-model-change) job that embeds every verse in the Quran
// and upserts the vectors into Supabase's `verse_embeddings` table, powering
// semanticSearch.service.ts.
//
// Usage:
//   npm run backfill:embeddings
//
// Requires in .env:
//   VOYAGE_API_KEY   — see embedding.service.ts
//   SUPABASE_URL
//   SUPABASE_ANON_KEY (must have insert rights — use the service role key
//                       for this one-off script if RLS blocks anon inserts)
//
// This talks to two external APIs (Quran.com for verse text, Voyage AI for
// embeddings) plus Supabase, so it needs network access and real
// credentials. It intentionally is NOT run automatically by CI or on app
// startup — it's a deliberate, explicit data-loading step, same as a
// database migration.
//
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { getSupabaseClient } from '../src/db/client.js';
import { embedBatch } from '../src/services/embedding.service.js';

const QURAN_API_BASE = process.env['QURAN_API_BASE'] ?? 'https://api.quran.com/api/v4';
const TOTAL_SURAHS = 114;
const EMBED_BATCH_SIZE = 96; // stay under Voyage's 128-per-request limit

interface RawVerse {
  verse_key: string;
  surah: number;
  ayah: number;
  translation: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches every verse + English translation (Sahih International, id 20)
 * for a single surah via Quran.com's chapter-level endpoint (one request
 * per surah rather than one per verse — 114 requests total instead of 6,236).
 */
async function fetchSurahVerses(surahNumber: number): Promise<RawVerse[]> {
  const url =
    `${QURAN_API_BASE}/verses/by_chapter/${surahNumber}` +
    `?translations=20&fields=text_uthmani&per_page=300`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'QuranWellbeingApp/1.0-backfill' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch surah ${surahNumber}: ${response.status}`);
  }

  const data = (await response.json()) as {
    verses: Array<{
      verse_key: string;
      translations?: Array<{ text: string }>;
    }>;
  };

  return data.verses.map((v) => {
    const [surah, ayah] = v.verse_key.split(':').map(Number);
    return {
      verse_key: v.verse_key,
      surah: surah ?? surahNumber,
      ayah: ayah ?? 0,
      translation: stripHtml(v.translations?.[0]?.text ?? ''),
    };
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`Fetching all ${TOTAL_SURAHS} surahs from Quran.com...`);

  const allVerses: RawVerse[] = [];
  for (let surah = 1; surah <= TOTAL_SURAHS; surah++) {
    const verses = await fetchSurahVerses(surah);
    allVerses.push(...verses);
    process.stdout.write(`\r  Surah ${surah}/${TOTAL_SURAHS} — ${allVerses.length} verses so far`);
  }
  console.log(`\nFetched ${allVerses.length} verses total.\n`);

  const supabase = getSupabaseClient();
  const batches = chunk(allVerses, EMBED_BATCH_SIZE);

  let done = 0;
  for (const batch of batches) {
    const texts = batch.map((v) => v.translation || `Verse ${v.verse_key}`);
    const embeddings = await embedBatch(texts, 'document');

    const rows = batch.map((v, i) => ({
      verse_key: v.verse_key,
      surah_number: v.surah,
      ayah_number: v.ayah,
      translation: v.translation,
      embedding: embeddings[i],
      model: 'voyage-3-lite',
    }));

    const { error } = await supabase.from('verse_embeddings').upsert(rows, {
      onConflict: 'verse_key',
    });

    if (error) {
      throw new Error(`Failed to upsert batch: ${error.message}`);
    }

    done += batch.length;
    process.stdout.write(`\r  Embedded + upserted ${done}/${allVerses.length} verses`);
  }

  console.log(`\n\nDone. verse_embeddings now has ${allVerses.length} rows.`);
  console.log('Semantic search (semanticSearch.service.ts) is now live.');
}

main().catch((err) => {
  console.error('\nBackfill failed:', err);
  process.exit(1);
});
