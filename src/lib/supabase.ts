import { createClient } from '@supabase/supabase-js'

// Server-side client with secret key for admin operations
export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabasePublishableKey)
}

export function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Missing Supabase environment variables')
  }

  if (!secretKey) {
    throw new Error('Missing SUPABASE_SECRET_KEY')
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
