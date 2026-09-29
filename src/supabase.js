import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Both values are public browser configuration. Authorization is enforced by RLS.
export const supabase = url && publishableKey
  ? createClient(url, publishableKey, { auth: { persistSession: true } })
  : null

export const scoreBucket = 'scores'
