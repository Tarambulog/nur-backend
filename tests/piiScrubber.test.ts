import { describe, it, expect } from 'vitest';
import { scrubPII, safeScrubPII, containsPII } from '../src/utils/piiScrubber.js';

describe('piiScrubber', () => {
  it('redacts email addresses', () => {
    const result = scrubPII('Reach me at yuji@example.com if you need anything.');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('yuji@example.com');
  });

  it('redacts self-introduced names', () => {
    const result = scrubPII("Hi, I'm Yuji Yoshida and I've been feeling anxious lately.");
    expect(result).toContain('[NAME]');
    expect(result).not.toContain('Yuji Yoshida');
  });

  it('redacts URLs', () => {
    const result = scrubPII('I read about it on https://example.com/some-page yesterday.');
    expect(result).toContain('[URL]');
    expect(result).not.toContain('https://example.com');
  });

  it('redacts long phone numbers but leaves short numeric mentions alone', () => {
    const withPhone = scrubPII('Call me at 555-123-4567 tonight.');
    expect(withPhone).toContain('[PHONE]');

    // A short number (e.g. a verse reference like "2:286") should not be
    // treated as a phone number — the scrubber only strips matches with
    // 7+ digits.
    const withVerseRef = scrubPII('I keep thinking about verse 2:286.');
    expect(withVerseRef).toContain('2:286');
  });

  it('redacts SSN-like identifiers', () => {
    const result = scrubPII('My ID is 123-45-6789 for reference.');
    expect(result).toContain('[ID]');
  });

  it('leaves ordinary text with no PII unchanged aside from whitespace normalisation', () => {
    const input = 'I feel overwhelmed and I do not know why.';
    expect(scrubPII(input)).toBe(input);
  });

  it('handles empty and whitespace-only input safely', () => {
    expect(scrubPII('')).toBe('');
    expect(scrubPII('   ')).toBe('   ');
  });

  it('safeScrubPII resets regex state between calls (stateful /g regex bug guard)', () => {
    // Calling scrubPII many times in a row with global regexes can silently
    // skip matches if lastIndex isn't reset — safeScrubPII exists specifically
    // to guard against that. Run it several times in a row and confirm each
    // call independently redacts.
    for (let i = 0; i < 5; i++) {
      const result = safeScrubPII(`Email me at person${i}@example.com please.`);
      expect(result).toContain('[EMAIL]');
    }
  });

  it('containsPII correctly flags text with and without PII', () => {
    expect(containsPII('Contact me at test@example.com')).toBe(true);
    expect(containsPII('I feel at peace today')).toBe(false);
  });
});
