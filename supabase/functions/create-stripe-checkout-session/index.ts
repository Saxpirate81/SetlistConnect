import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

type Tier = 'pro' | 'agency'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const PRICE_ID_PRO = Deno.env.get('STRIPE_PRICE_ID_PRO') ?? ''
const PRICE_ID_AGENCY = Deno.env.get('STRIPE_PRICE_ID_AGENCY') ?? ''
const SUCCESS_URL = Deno.env.get('STRIPE_CHECKOUT_SUCCESS_URL') ?? ''
const CANCEL_URL = Deno.env.get('STRIPE_CHECKOUT_CANCEL_URL') ?? ''

if (!STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY')
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
if (!SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY')
if (!PRICE_ID_PRO) throw new Error('Missing STRIPE_PRICE_ID_PRO')
if (!PRICE_ID_AGENCY) throw new Error('Missing STRIPE_PRICE_ID_AGENCY')
if (!SUCCESS_URL) throw new Error('Missing STRIPE_CHECKOUT_SUCCESS_URL')
if (!CANCEL_URL) throw new Error('Missing STRIPE_CHECKOUT_CANCEL_URL')

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401)

    const payload = await req.json().catch(() => null) as { bandId?: string; tier?: string } | null
    const bandId = String(payload?.bandId ?? '').trim()
    const tier = String(payload?.tier ?? '').trim().toLowerCase() as Tier
    if (!bandId) return json({ error: 'Missing bandId' }, 400)
    if (tier !== 'pro' && tier !== 'agency') return json({ error: 'Invalid tier' }, 400)

    const { data: membership, error: membershipError } = await userClient
      .from('band_memberships')
      .select('id')
      .eq('band_id', bandId)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .eq('role', 'admin')
      .maybeSingle()
    if (membershipError) return json({ error: membershipError.message }, 400)
    if (!membership) return json({ error: 'Band admin access required' }, 403)

    const price = tier === 'agency' ? PRICE_ID_AGENCY : PRICE_ID_PRO
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      client_reference_id: bandId,
      metadata: {
        band_id: bandId,
        tier,
        requested_by_user_id: userData.user.id,
      },
      subscription_data: {
        metadata: {
          band_id: bandId,
          tier,
          requested_by_user_id: userData.user.id,
        },
      },
      allow_promotion_codes: true,
    })

    return json({ url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return json({ error: message }, 400)
  }
})

