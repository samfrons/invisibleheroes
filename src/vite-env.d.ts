/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Supabase project URL for the relay carrier (src/net/relay-supabase.ts). Empty: relay off. */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase publishable (anon) key. Never a service-role key: it ships in the page. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
