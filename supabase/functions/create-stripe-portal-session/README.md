# create-stripe-portal-session

Supabase Edge Function that creates a Stripe Customer Portal session for a band admin.

## Required Secrets

- `STRIPE_SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_PORTAL_RETURN_URL`

## Deploy

```bash
supabase functions deploy create-stripe-portal-session
```

## Request Body

```json
{
  "bandId": "<band-uuid>"
}
```

Only active admins of the band can create a portal session.

