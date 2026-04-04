import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ylmsomkljcqcjpztslug.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_cUd8snCxGcpaws7pRWgU2Q_VpaQb-jV';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
