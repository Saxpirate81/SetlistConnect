create extension if not exists pgcrypto;

create table if not exists public."SetlistBandSubscriptions" (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'pro', 'agency')),
  status text not null default 'active' check (
    status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid')
  ),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (band_id)
);

create index if not exists "SetlistBandSubscriptions_band_id_idx"
  on public."SetlistBandSubscriptions"(band_id);

create index if not exists "SetlistBandSubscriptions_subscription_id_idx"
  on public."SetlistBandSubscriptions"(stripe_subscription_id);

create or replace function public.set_setlist_band_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_setlist_band_subscriptions_updated_at
  on public."SetlistBandSubscriptions";

create trigger set_setlist_band_subscriptions_updated_at
before update on public."SetlistBandSubscriptions"
for each row
execute function public.set_setlist_band_subscriptions_updated_at();

alter table public."SetlistBandSubscriptions" enable row level security;

drop policy if exists "band subscription read for active members"
  on public."SetlistBandSubscriptions";

create policy "band subscription read for active members"
on public."SetlistBandSubscriptions"
for select
to authenticated
using (
  exists (
    select 1
    from public.band_memberships bm
    where bm.band_id = "SetlistBandSubscriptions".band_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
  )
);

do $$
begin
  alter publication supabase_realtime add table public."SetlistBandSubscriptions";
exception
  when duplicate_object then null;
end $$;

