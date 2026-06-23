console.log('SUPABASE FILE LOADED');

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

const SUPABASE_URL = 'https://zbbhhlxdduhkvyhiesba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_V1l8_4xCq5aJFvt7Vzph8w_5fGOS64u';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('Supabase client initialized');
