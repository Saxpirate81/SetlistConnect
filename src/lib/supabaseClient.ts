import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const forceLocalModeRaw = import.meta.env.VITE_FORCE_LOCAL_MODE as string | undefined
const forceLocalMode = ['1', 'true', 'yes', 'on'].includes(
  (forceLocalModeRaw ?? '').toLowerCase(),
)

export const supabaseEnvStatus = {
  hasUrl: Boolean(supabaseUrl),
  hasAnonKey: Boolean(supabaseAnonKey),
  forceLocalMode,
}

export const isSupabaseEnabled =
  supabaseEnvStatus.hasUrl && supabaseEnvStatus.hasAnonKey && !supabaseEnvStatus.forceLocalMode

export const supabase = isSupabaseEnabled
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null
