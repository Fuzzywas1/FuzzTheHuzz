import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://dfourigvvmzrimtcdday.supabase.co";

/*
 * Paste your Supabase anon key below.
 *
 * Use the same anon key you previously placed in .env.
 * Never put the secret/service-role key here.
 */
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmb3VyaWd2dm16cmltdGNkZGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MDg3MDcsImV4cCI6MjEwMDA4NDcwN30.0By4RvBoacLJFJDAfX38_w4fNP3MmsLdnzNx4n3iMR0";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);