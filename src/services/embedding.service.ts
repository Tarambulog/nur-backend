// ─── Embedding Service ─────────────────────────────────────────────────────────
//
// Wraps Voyage AI's embeddings API (Anthropic's recommended embeddings
// partner — Claude itself does not expose an embeddings endpoint). Used to
// turn free text (Quran verse translations, and user check-in text) into
// vectors for semantic similarity search.
//
// Deliberately isolated behind a small interface so the rest of the app
// never imports voyageai's client directly — swapping providers later
// (OpenAI, Cohere, a self-hosted model) means changing only this file.
//
// ─────────────────────────────────────────────────────────────────────────────

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3-lite';
const EMBEDDING_DIMENSION = 1024;

export class EmbeddingUnavailableError extends Error {
  constructor(reason: string) {
    super(`Embeddings unavailable: ${reason}`);
    this.name = 'EmbeddingUnavailableError';
  }
}

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

function getApiKey(): string {
  const key = process.env['VOYAGE_API_KEY'];
  if (!key) {
    throw new EmbeddingUnavailableError('Missing VOYAGE_API_KEY environment variable.');
  }
  return key;
}

/**
 * Embeds a batch of text strings in a single API call.
 * Voyage AI supports up to 128 inputs per request; callers embedding the
 * full Quran corpus (6,236 verses) should chunk their input accordingly
 * (see scripts/backfillEmbeddings.ts).
 *
 * `inputType` tells the model whether the text is a search query or a
 * document being indexed — Voyage's asymmetric models use this to produce
 * better-aligned vectors for retrieval than embedding both sides identically.
 */
export async function embedBatch(
  texts: string[],
  inputType: 'query' | 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 128) {
    throw new Error(`embedBatch received ${texts.length} texts; Voyage AI's limit is 128 per request.`);
  }

  const apiKey = getApiKey();

  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Voyage AI embeddings request failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as VoyageEmbeddingResponse;

  // Voyage returns results possibly out of order; re-sort by index to
  // guarantee embeddings[i] corresponds to texts[i].
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

/**
 * Embeds a single piece of text (convenience wrapper around embedBatch).
 */
export async function embedText(
  text: string,
  inputType: 'query' | 'document',
): Promise<number[]> {
  const [embedding] = await embedBatch([text], inputType);
  if (!embedding) {
    throw new Error('Embedding response did not contain a vector.');
  }
  return embedding;
}

/**
 * Returns true if embeddings are configured (i.e. VOYAGE_API_KEY is set).
 * Callers use this to decide whether to attempt semantic search at all,
 * so a missing key produces one clean log line instead of a failed
 * network call on every request.
 */
export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env['VOYAGE_API_KEY']);
}

export const EMBEDDING_MODEL_NAME = EMBEDDING_MODEL;
export const EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSION;
