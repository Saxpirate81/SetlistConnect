# stripe-webhook

Supabase Edge Function that receives Stripe webhook events and syncs `SetlistBandSubscriptions`.

## Required Secrets

Set in Supabase project settings (Functions secrets):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL` (provided by Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase)
- `STRIPE_PRICE_ID_PRO` (optional but recommended)
- `STRIPE_PRICE_ID_AGENCY` (optional but recommended)

## Deploy

```bash
supabase functions deploy stripe-webhook
```

## Stripe Webhook Endpoint

Point Stripe to:

`https://<PROJECT-REF>.functions.supabase.co/stripe-webhook`

Subscribe to events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Important

When creating checkout sessions, include `band_id` in metadata (or `client_reference_id`) so the webhook can map the subscription to a band.
