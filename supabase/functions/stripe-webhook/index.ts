import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

type Tier = 'free' | 'pro' | 'agency'
type StripeStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_PRICE_ID_PRO = Deno.env.get('STRIPE_PRICE_ID_PRO') ?? ''
const STRIPE_PRICE_ID_AGENCY = Deno.env.get('STRIPE_PRICE_ID_AGENCY') ?? ''

if (!STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY')
if (!STRIPE_WEBHOOK_SECRET) throw new Error('Missing STRIPE_WEBHOOK_SECRET')
if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL')
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const normalizeTier = (raw: string | null | undefined): Tier => {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'pro') return 'pro'
  if (value === 'agency' || value === 'business') return 'agency'
  return 'free'
}

const tierFromPriceId = (priceId: string | null | undefined): Tier => {
  const value = String(priceId ?? '').trim()
  if (!value) return 'free'
  if (STRIPE_PRICE_ID_AGENCY && value === STRIPE_PRICE_ID_AGENCY) return 'agency'
  if (STRIPE_PRICE_ID_PRO && value === STRIPE_PRICE_ID_PRO) return 'pro'
  return 'free'
}

const toSubStatus = (raw: string | null | undefined): StripeStatus => {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'active') return 'active'
  if (value === 'trialing') return 'trialing'
  if (value === 'past_due') return 'past_due'
  if (value === 'incomplete') return 'incomplete'
  if (value === 'incomplete_expired') return 'incomplete_expired'
  if (value === 'unpaid') return 'unpaid'
  return 'canceled'
}

const periodEndToIso = (value: number | null | undefined) =>
  value ? new Date(value * 1000).toISOString() : null

const resolveTierFromSubscription = (subscription: Stripe.Subscription): Tier => {
  const explicit = normalizeTier(subscription.metadata?.tier)
  if (explicit !== 'free') return explicit
  const firstPrice = subscription.items.data[0]?.price?.id
  const byPrice = tierFromPriceId(firstPrice)
  if (byPrice !== 'free') return byPrice
  return normalizeTier(subscription.items.data[0]?.price?.lookup_key)
}

const upsertSubscription = async (
  subscription: Stripe.Subscription,
  bandId: string,
  metadata: Record<string, unknown> = {},
) => {
  const tier = resolveTierFromSubscription(subscription)
  const status = toSubStatus(subscription.status)
  const priceId = subscription.items.data[0]?.price?.id ?? null
  const row = {
    band_id: bandId,
    tier,
    status,
    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    current_period_end: periodEndToIso(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    metadata,
  }

  const { error } = await supabase
    .from('SetlistBandSubscriptions')
    .upsert(row, { onConflict: 'band_id' })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

const bandIdFromExistingSubscription = async (subscriptionId: string) => {
  const { data, error } = await supabase
    .from('SetlistBandSubscriptions')
    .select('band_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()
  if (error) throw new Error(`Supabase lookup failed: ${error.message}`)
  return data?.band_id ?? null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const signature = req.headers.get('stripe-signature')
    if (!signature) return json({ error: 'Missing stripe-signature header' }, 400)

    const rawBody = await req.text()
    const event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode === 'subscription' && session.subscription) {
        const bandId =
          session.metadata?.band_id ??
          (typeof session.client_reference_id === 'string' ? session.client_reference_id : null)
        if (!bandId) return json({ ok: true, skipped: 'missing_band_id' })

        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription.id
        const subscription = await stripe.subscriptions.retrieve(subId)
        await upsertSubscription(subscription, bandId, {
          source: 'checkout.session.completed',
          checkout_session_id: session.id,
        })
      }
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription
      const metadataBandId = subscription.metadata?.band_id ?? null
      const bandId = metadataBandId || await bandIdFromExistingSubscription(subscription.id)
      if (!bandId) return json({ ok: true, skipped: 'missing_band_mapping' })

      await upsertSubscription(subscription, bandId, {
        source: event.type,
      })
    }

    return json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return json({ error: message }, 400)
  }
})

