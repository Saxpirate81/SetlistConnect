# create-stripe-checkout-session

Supabase Edge Function that creates Stripe Checkout sessions for `pro` or `agency`.

## Required Secrets

- `STRIPE_SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_PRICE_ID_PRO`
- `STRIPE_PRICE_ID_AGENCY` (optional; only needed if the Agency tier is re-enabled)
- `STRIPE_CHECKOUT_SUCCESS_URL`
- `STRIPE_CHECKOUT_CANCEL_URL`

## Deploy

```bash
supabase functions deploy create-stripe-checkout-session
```

## Request Body

```json
{
  "bandId": "<band-uuid>",
  "tier": "pro"
}
```

Only active band admins can create checkout sessions for that band.
