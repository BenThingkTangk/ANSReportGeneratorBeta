/**
 * client/src/lib/supabase.ts
 * Supabase anon client for the browser.
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a noop client when env vars are missing (e.g. local dev without Supabase)
    console.warn(
      "VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set — Supabase features disabled"
    );
  }
  _client = createClient(
    supabaseUrl || "https://placeholder.supabase.co",
    supabaseAnonKey || "placeholder",
    {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );
  return _client;
}

export default getSupabase;
