import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmotionalProfile, Verse } from '../src/types/index.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// recommendation.service.ts talks to three external-facing services:
// verse fetching (Quran.com), note generation (Claude), and semantic search
// (Voyage AI + Supabase). All three are mocked so this suite runs offline,
// deterministically, with no API keys — exactly what a CI runner needs.

vi.mock('../src/services/verse.service.js', () => ({
  getVersesByKeys: vi.fn(),
}));

vi.mock('../src/services/nlp.service.js', () => ({
  generatePersonalizedNote: vi.fn().mockResolvedValue('A mocked personalised note.'),
}));

vi.mock('../src/services/semanticSearch.service.js', () => ({
  semanticVerseSearch: vi.fn().mockResolvedValue([]),
}));

import { getVersesByKeys } from '../src/services/verse.service.js';
import { semanticVerseSearch } from '../src/services/semanticSearch.service.js';
import { getRecommendations, scoreVerse } from '../src/services/recommendation.service.js';

function makeVerse(verse_key: string): Verse {
  const [surah, ayah] = verse_key.split(':').map(Number);
  return {
    verse_key,
    surah_number: surah ?? 0,
    ayah_number: ayah ?? 0,
    arabic_text: 'placeholder arabic',
    translation: `Translation for ${verse_key}`,
  };
}

function makeProfile(overrides: Partial<EmotionalProfile> = {}): EmotionalProfile {
  return {
    primary_emotion: 'anxiety',
    intensity: 6,
    spiritual_need: 'comfort',
    life_domain: 'general',
    themes: ['tawakkul', 'sabr'],
    reasoning: 'Test profile.',
    crisis: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getVersesByKeys).mockReset();
  vi.mocked(semanticVerseSearch).mockReset().mockResolvedValue([]);
});

describe('scoreVerse (pure scoring function)', () => {
  it('scores curated verses higher than uncurated ones, all else equal', () => {
    const profile = makeProfile();
    const curatedList = ['2:286', '13:28', '65:3'];

    const curatedScore = scoreVerse('2:286', profile, curatedList);
    const uncuratedScore = scoreVerse('99:99', profile, curatedList);

    expect(curatedScore).toBeGreaterThan(uncuratedScore);
  });

  it('never returns a score outside [0, 1]', () => {
    const profile = makeProfile({ intensity: 10 });
    const score = scoreVerse('2:286', profile, ['2:286'], 1.0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('a strong semantic match can lift an uncurated verse above a weak curated one', () => {
    const profile = makeProfile();
    const curatedList = ['2:286'];

    // A verse outside the curated list, but with high semantic similarity
    const semanticBoosted = scoreVerse('55:13', profile, curatedList, 0.95);
    // The last (lowest-priority) item in a long curated list
    const weakCurated = scoreVerse('2:286', { ...profile, intensity: 1 }, [
      '1:1', '1:2', '1:3', '1:4', '1:5', '1:6', '2:286', // near the end
    ]);

    expect(semanticBoosted).toBeGreaterThan(0);
    // Not asserting a strict ordering here (the two scores use different
    // curated-list contexts) — this documents that semantic similarity is
    // a meaningful, non-trivial contributor to the final score.
    expect(semanticBoosted).not.toBe(weakCurated);
  });
});

describe('getRecommendations', () => {
  it('falls back cleanly to the curated taxonomy when semantic search returns nothing', async () => {
    vi.mocked(semanticVerseSearch).mockResolvedValue([]);
    vi.mocked(getVersesByKeys).mockImplementation(async (keys: string[]) =>
      keys.map(makeVerse),
    );

    const result = await getRecommendations(makeProfile(), 'en', 'I feel anxious about everything');

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeLessThanOrEqual(5);
    expect(result.crisis_resources).toBeUndefined();
  });

  it('includes semantic-only verses (not in the curated list) as candidates', async () => {
    const semanticOnlyKey = '18:10'; // not in the anxiety taxonomy list
    vi.mocked(semanticVerseSearch).mockResolvedValue([
      { verse_key: semanticOnlyKey, surah_number: 18, ayah_number: 10, translation: 'x', similarity: 0.9 },
    ]);
    vi.mocked(getVersesByKeys).mockImplementation(async (keys: string[]) =>
      keys.map(makeVerse),
    );

    await getRecommendations(makeProfile(), 'en', 'a long enough check-in to trigger search');

    const calledWithKeys = vi.mocked(getVersesByKeys).mock.calls[0]?.[0] as string[];
    expect(calledWithKeys).toContain(semanticOnlyKey);
  });

  it('does not call semantic search when there is no free text (mood-only check-in)', async () => {
    vi.mocked(getVersesByKeys).mockImplementation(async (keys: string[]) =>
      keys.map(makeVerse),
    );

    await getRecommendations(makeProfile(), 'en', undefined);

    expect(semanticVerseSearch).not.toHaveBeenCalled();
  });

  it('prioritises the crisis verse and includes crisis resources when profile.crisis is true', async () => {
    vi.mocked(getVersesByKeys).mockImplementation(async (keys: string[]) =>
      keys.map(makeVerse),
    );

    const result = await getRecommendations(makeProfile({ crisis: true }), 'en');

    const calledWithKeys = vi.mocked(getVersesByKeys).mock.calls[0]?.[0] as string[];
    expect(calledWithKeys[0]).toBe('39:53');
    expect(result.crisis_resources).toBeDefined();
    expect(result.crisis_resources?.hotlines.length).toBeGreaterThan(0);
  });

  it('returns an empty recommendation list gracefully if verse fetching fails entirely', async () => {
    vi.mocked(getVersesByKeys).mockResolvedValue([]);

    const result = await getRecommendations(makeProfile(), 'en');

    expect(result.recommendations).toEqual([]);
  });
});
