import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zbbhhlxdduhkvyhiesba.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_V1l8_4xCq5aJFvt7Vzph8w_5fGOS64u';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('Supabase client initialized');
