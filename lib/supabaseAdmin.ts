import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client. The service-role key bypasses Storage/DB RLS so API routes
// can read/write the private `print-files` bucket (T20). Never import this into
// client code. Lazy so importing a module that only needs validateUpload() does
// not require the key to be set.
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
