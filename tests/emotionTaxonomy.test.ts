import { describe, it, expect } from 'vitest';
import {
  EMOTION_TAXONOMY,
  getEmotionEntry,
  getFallbackVerseKeys,
  getEmotionThemes,
  getAllEmotions,
  CRISIS_VERSE_KEY,
  CRISIS_SUPPORT_VERSE_KEYS,
} from '../src/utils/emotionTaxonomy.js';
import type { EmotionState } from '../src/types/index.js';

const EXPECTED_EMOTIONS: EmotionState[] = [
  'anxiety', 'sadness', 'anger', 'loneliness', 'gratitude', 'hope',
  'guilt', 'confusion', 'peace', 'overwhelmed', 'grief', 'disconnection', 'joy',
];

describe('emotionTaxonomy', () => {
  it('defines all 13 supported emotion states', () => {
    const emotions = getAllEmotions();
    expect(emotions).toHaveLength(13);
    for (const emotion of EXPECTED_EMOTIONS) {
      expect(emotions).toContain(emotion);
    }
  });

  it('gives every emotion at least 3 fallback verses, in verse-key format', () => {
    for (const emotion of getAllEmotions()) {
      const keys = getFallbackVerseKeys(emotion);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      for (const key of keys) {
        expect(key).toMatch(/^\d+:\d+$/);
      }
    }
  });

  it('gives every emotion at least 2 Quranic themes', () => {
    for (const emotion of getAllEmotions()) {
      const themes = getEmotionThemes(emotion);
      expect(themes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('getEmotionEntry returns a fully-populated taxonomy entry', () => {
    const entry = getEmotionEntry('anxiety');
    expect(entry.emotion).toBe('anxiety');
    expect(entry.arabic_concept).toContain('Tawakkul');
    expect(entry.spiritual_need).toBe('comfort');
    expect(entry.tone).toBe('comforting');
  });

  it('every taxonomy entry has a spiritual_need drawn from the valid set', () => {
    const validNeeds = ['comfort', 'guidance', 'meaning', 'forgiveness', 'gratitude'];
    for (const emotion of getAllEmotions()) {
      expect(validNeeds).toContain(EMOTION_TAXONOMY[emotion].spiritual_need);
    }
  });

  it('crisis verse (39:53) exists and is not duplicated in its own support list', () => {
    expect(CRISIS_VERSE_KEY).toBe('39:53');
    expect(CRISIS_SUPPORT_VERSE_KEYS).not.toContain(CRISIS_VERSE_KEY);
    expect(CRISIS_SUPPORT_VERSE_KEYS.length).toBeGreaterThan(0);
  });
});
