// ─── Semantic Search Service (RAG retrieval) ──────────────────────────────────
//
// Given free-text describing how a user feels, finds the Quran verses whose
// translations are semantically closest — via vector similarity, not
// keyword or hand-tagged emotion matching. This is the piece that upgrades
// the app from "call an LLM and parse JSON" to an actual retrieval system.
//
// Requires:
//   1. VOYAGE_API_KEY set (see embedding.service.ts)
//   2. The `verse_embeddings` table populated (see
//      scripts/backfillEmbeddings.ts) — a one-time job per embedding model.
//
// If either precondition isn't met, callers should catch and fall back to
// the curated taxonomy in emotionTaxonomy.ts — see recommendation.service.ts
// for how the two are combined. Semantic search augments the deterministic
// fallback; it never replaces it outright.
//
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from '../db/client.js';
import { embedText, isEmbeddingConfigured, EmbeddingUnavailableError } from './embedding.service.js';

export interface SemanticMatch {
  verse_key: string;
  surah_number: number;
  ayah_number: number;
  translation: string;
  similarity: number; // 0–1, cosine similarity
}

/**
 * Finds the verses whose translations are most semantically similar to
 * `queryText`. Returns an empty array (never throws for "not configured")
 * so callers can treat "no semantic results" the same as "no embeddings
 * configured yet" — both just mean "fall back to the taxonomy."
 */
export async function semanticVerseSearch(
  queryText: string,
  options: { matchCount?: number; minSimilarity?: number } = {},
): Promise<SemanticMatch[]> {
  const { matchCount = 8, minSimilarity = 0.3 } = options;

  if (!queryText || queryText.trim().length < 5) {
    return [];
  }

  if (!isEmbeddingConfigured()) {
    return [];
  }

  try {
    const queryEmbedding = await embedText(queryText, 'query');

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('match_verses', {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      min_similarity: minSimilarity,
    });

    if (error) {
      console.warn('[semanticSearch] Supabase RPC failed:', error.message);
      return [];
    }

    return (data ?? []) as SemanticMatch[];
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) {
      // Expected when running without a Voyage key configured — not an error.
      return [];
    }
    console.warn('[semanticSearch] Embedding/search failed, falling back to taxonomy:', err);
    return [];
  }
}
