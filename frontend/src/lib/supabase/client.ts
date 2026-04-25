import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env vars are missing. If this fired during prerender, you called createClient() at module or component scope in a "use client" page — move it into an event handler or useEffect.',
    );
  }
  return createBrowserClient(url, anonKey);
}
