import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  DbUser,
  DbCheckin,
  DbVerseRecommendation,
  DbSavedVerse,
  DbJournalEntry,
  DbVerseEmotionalTag,
  DbVerseEmbedding,
} from '../types/index.js';

// ─── Database Schema Types ────────────────────────────────────────────────────

export interface Database {
  // Required by @supabase/supabase-js 2.x's typed client so it resolves
  // the modern (PostgREST 13) generic overloads correctly — without this,
  // `.upsert()` and `.rpc()` silently degrade to `never` argument types.
  // This mirrors what `supabase gen types typescript` emits automatically;
  // since this schema is hand-written (no live Supabase project to
  // generate against yet), it's declared explicitly here instead.
  __InternalSupabase: {
    PostgrestVersion: '13';
  };
  public: {
    Tables: {
      users: {
        Row: DbUser;
        Insert: Omit<DbUser, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DbUser, 'id' | 'created_at'>>;
        Relationships: [];
      };
      check_ins: {
        Row: DbCheckin;
        Insert: Omit<DbCheckin, 'id' | 'created_at'>;
        Update: Partial<Omit<DbCheckin, 'id' | 'created_at'>>;
        Relationships: [];
      };
      verse_recommendations: {
        Row: DbVerseRecommendation;
        Insert: Omit<DbVerseRecommendation, 'id' | 'created_at'>;
        Update: Partial<Omit<DbVerseRecommendation, 'id' | 'created_at'>>;
        Relationships: [];
      };
      saved_verses: {
        Row: DbSavedVerse;
        Insert: Omit<DbSavedVerse, 'id' | 'created_at'>;
        Update: Partial<Omit<DbSavedVerse, 'id' | 'created_at'>>;
        Relationships: [];
      };
      journal_entries: {
        Row: DbJournalEntry;
        Insert: Omit<DbJournalEntry, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DbJournalEntry, 'id' | 'created_at'>>;
        Relationships: [];
      };
      verse_emotional_tags: {
        Row: DbVerseEmotionalTag;
        Insert: Omit<DbVerseEmotionalTag, 'id' | 'created_at'>;
        Update: Partial<Omit<DbVerseEmotionalTag, 'id' | 'created_at'>>;
        Relationships: [];
      };
      verse_embeddings: {
        Row: DbVerseEmbedding;
        Insert: DbVerseEmbedding;
        Update: Partial<DbVerseEmbedding>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_verses: {
        Args: {
          query_embedding: number[];
          match_count: number;
          min_similarity: number;
        };
        Returns: Array<{
          verse_key: string;
          surah_number: number;
          ayah_number: number;
          translation: string;
          similarity: number;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ─── Supabase Client Singleton ────────────────────────────────────────────────

let _client: SupabaseClient<Database> | null = null;

/**
 * Returns a singleton Supabase client initialised from environment variables.
 * Throws clearly if the required env vars are not set.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (_client) {
    return _client;
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error(
      'Missing SUPABASE_URL environment variable. Check your .env file.',
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing SUPABASE_ANON_KEY environment variable. Check your .env file.',
    );
  }

  _client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      // We use the anon key for server-side calls on behalf of unauthenticated
      // users; when a user token is available it should be passed per-request.
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-application-name': 'quran-wellbeing-backend',
      },
    },
  });

  return _client;
}

/**
 * Convenience export so callers can do: import { supabase } from '../db/client'
 */
export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
