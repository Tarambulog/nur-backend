#!/usr/bin/env tsx
// ─── Seed Demo Users ────────────────────────────────────────────────────────
//
// Creates 50 demo users (Supabase Auth account + public.users profile +
// a handful of synthetic check-ins each) so the app — and an admin/analytics
// view built on top of it — has a realistic-looking, populated database to
// demo against, without needing 50 real people to sign up.
//
// This is synthetic data end to end: no live Claude or Voyage AI calls are
// made (that would be slow, cost money per user, and isn't the point of a
// seed script) — emotional profiles are generated locally from the same
// curated emotion taxonomy the app already ships with.
//
// Usage:
//   npm run seed:demo-users
//
// Requires in .env:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  — the ANON key cannot do this: creating
//     Supabase Auth users requires the admin API, and inserting rows with
//     an explicit id (so public.users.id matches the auth user's id, which
//     the RLS policies in schema.sql assume) needs to bypass Row Level
//     Security. The service role key is meant for exactly this — trusted,
//     server-side, one-off admin scripts — never ship it to the mobile app
//     or commit it to source control (see .env.example).
//
// Demo accounts are all @nurdemo.test addresses with random passwords
// nobody has — they're identifiable and safe to bulk-delete later via the
// Supabase dashboard (Authentication -> filter by domain) if you want a
// clean slate.
//
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { EMOTION_TAXONOMY, getAllEmotions } from '../src/utils/emotionTaxonomy.js';
import type { EmotionalProfile, LifeDomain } from '../src/types/index.js';

const DEMO_USER_COUNT = 50;
const EMAIL_DOMAIN = 'nurdemo.test'; // reserved TLD-safe domain, never sends real mail

const FIRST_NAMES = [
  'Amara', 'Yusuf', 'Layla', 'Omar', 'Zainab', 'Bilal', 'Fatima', 'Hamza',
  'Noor', 'Idris', 'Maryam', 'Rayan', 'Aisha', 'Karim', 'Sara', 'Adam',
  'Hana', 'Zayd', 'Leila', 'Samir',
];

const LAST_NAMES = [
  'Rahman', 'Haddad', 'Karimi', 'Suleiman', 'Farouk', 'Malik', 'Hassan',
  'Aziz', 'Saleh', 'Yousef', 'Bakr', 'Nasser', 'Amin', 'Sultan', 'Hakimi',
];

const LIFE_DOMAINS: LifeDomain[] = ['general', 'relationships', 'work', 'health', 'faith', 'family'];
const LANGUAGES = ['en', 'ar', 'ur', 'ms'];

function pick<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error('pick() called on empty array');
  return item;
}

function randomIntensity(): number {
  return Math.floor(Math.random() * 10) + 1;
}

function randomEmotionalProfile(): EmotionalProfile {
  const emotion = pick(getAllEmotions());
  const entry = EMOTION_TAXONOMY[emotion];
  return {
    primary_emotion: emotion,
    intensity: randomIntensity(),
    spiritual_need: entry.spiritual_need,
    life_domain: pick(LIFE_DOMAINS),
    themes: entry.themes.slice(0, 2),
    reasoning: `Demo check-in — synthetic data reflecting ${emotion}.`,
    crisis: false,
  };
}

async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env. ' +
      'This script needs admin rights (service role key) to create auth users — ' +
      'the anon key will not work here. See the comment at the top of this file.',
    );
  }

  // Deliberately not using the typed Database client from db/client.ts here:
  // that client's generic Insert types assume `id` is server-generated,
  // but this script needs to set `id` explicitly so public.users.id matches
  // the Supabase Auth user id (what the RLS policies in schema.sql expect).
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Seeding ${DEMO_USER_COUNT} demo users into ${url}...\n`);

  let usersCreated = 0;
  let checkinsCreated = 0;

  for (let i = 1; i <= DEMO_USER_COUNT; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = `demo.user${String(i).padStart(2, '0')}@${EMAIL_DOMAIN}`;
    const password = randomUUID(); // nobody signs in with these — seed data only

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `${firstName} ${lastName}` },
    });

    if (createError || !created.user) {
      console.warn(`  [${i}/${DEMO_USER_COUNT}] Skipped ${email}: ${createError?.message ?? 'unknown error'}`);
      continue;
    }

    const userId = created.user.id;

    const { error: profileError } = await admin.from('users').insert({
      id: userId,
      email,
      display_name: `${firstName} ${lastName}`,
      language_preference: pick(LANGUAGES),
      notification_enabled: Math.random() > 0.5,
    });

    if (profileError) {
      console.warn(`  [${i}/${DEMO_USER_COUNT}] Profile insert failed for ${email}: ${profileError.message}`);
      continue;
    }

    usersCreated += 1;

    // 1-3 synthetic check-ins per user, each with 1-2 verse recommendations,
    // so the database looks like an app that's actually been used —
    // useful for demoing an admin/analytics dashboard against real-shaped data.
    const checkinCount = Math.floor(Math.random() * 3) + 1;
    for (let c = 0; c < checkinCount; c += 1) {
      const profile = randomEmotionalProfile();
      const checkinId = randomUUID();

      const { error: checkinError } = await admin.from('check_ins').insert({
        id: checkinId,
        user_id: userId,
        input_type: 'text',
        emotional_profile: profile,
        language: 'en',
      });

      if (checkinError) {
        console.warn(`    Check-in insert failed: ${checkinError.message}`);
        continue;
      }

      checkinsCreated += 1;

      const verseKeys = EMOTION_TAXONOMY[profile.primary_emotion].fallback_verse_keys.slice(0, 2);
      const recRows = verseKeys.map((verse_key, idx) => ({
        checkin_id: checkinId,
        verse_key,
        personalized_note: `Demo note — this verse was matched to a ${profile.primary_emotion} check-in.`,
        relevance_score: Math.round((0.6 + Math.random() * 0.4) * 1000) / 1000,
        rank_position: idx + 1,
        was_saved: Math.random() > 0.7,
      }));

      if (recRows.length > 0) {
        const { error: recError } = await admin.from('verse_recommendations').insert(recRows);
        if (recError) {
          console.warn(`    Verse recommendation insert failed: ${recError.message}`);
        }
      }
    }

    process.stdout.write(`\r  ${i}/${DEMO_USER_COUNT} users seeded`);
  }

  console.log(`\n\nDone. ${usersCreated}/${DEMO_USER_COUNT} demo users created, ${checkinsCreated} synthetic check-ins.`);
  console.log(`Emails follow the pattern demo.userNN@${EMAIL_DOMAIN} — safe to bulk-delete later via the Supabase dashboard.`);
}

main().catch((err) => {
  console.error('\nSeeding failed:', err);
  process.exit(1);
});
