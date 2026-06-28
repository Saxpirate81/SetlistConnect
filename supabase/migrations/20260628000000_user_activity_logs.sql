-- ─────────────────────────────────────────────────────────────────────────────
-- User Activity Logs
-- Tracks all significant user actions for debugging, analytics, and support.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_activity_logs (
  id            uuid        primary key default gen_random_uuid(),

  -- Who did it
  user_id       uuid        references auth.users(id) on delete set null,
  band_id       uuid        references public.bands(id) on delete set null,

  -- What happened
  event         text        not null,
  payload       jsonb       not null default '{}'::jsonb,

  -- Session / client context
  session_id    text,
  app_version   text,
  client_info   jsonb       not null default '{}'::jsonb,

  -- When
  occurred_at   timestamptz not null default timezone('utc', now()),
  created_at    timestamptz not null default timezone('utc', now())
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Most common queries: filter by user or band, order by time
create index if not exists user_activity_logs_user_id_idx
  on public.user_activity_logs (user_id, occurred_at desc);

create index if not exists user_activity_logs_band_id_idx
  on public.user_activity_logs (band_id, occurred_at desc);

-- Filter by event type
create index if not exists user_activity_logs_event_idx
  on public.user_activity_logs (event);

-- Filter by session
create index if not exists user_activity_logs_session_id_idx
  on public.user_activity_logs (session_id);

-- Time-range queries
create index if not exists user_activity_logs_occurred_at_idx
  on public.user_activity_logs (occurred_at desc);

-- ─── Row Level Security ───────────────────────────────────────────────────────

alter table public.user_activity_logs enable row level security;

-- Users can insert their own logs (the app writes logs on their behalf)
create policy "users can insert own logs"
  on public.user_activity_logs
  for insert
  to authenticated
  with check (user_id = auth.uid() or user_id is null);

-- Users can read their own logs
create policy "users can read own logs"
  on public.user_activity_logs
  for select
  to authenticated
  using (user_id = auth.uid());

-- Band admins can read all logs for their band
create policy "band admins can read band logs"
  on public.user_activity_logs
  for select
  to authenticated
  using (
    band_id is not null
    and exists (
      select 1
      from public.band_memberships bm
      where bm.band_id = user_activity_logs.band_id
        and bm.user_id = auth.uid()
        and bm.role in ('admin', 'owner')
        and bm.status = 'active'
    )
  );

-- ─── Auto-prune: keep only last 90 days to avoid table bloat ─────────────────
-- Run this as a Supabase cron job (Dashboard → Database → Cron Jobs):
--   schedule: 0 3 * * *   (daily at 3am UTC)
--   command:  delete from public.user_activity_logs where occurred_at < now() - interval '90 days';

-- ─── Helpful view for recent errors ──────────────────────────────────────────

create or replace view public.recent_error_logs as
select
  id,
  user_id,
  band_id,
  event,
  payload->>'error' as error_message,
  session_id,
  app_version,
  client_info->>'userAgent' as user_agent,
  occurred_at
from public.user_activity_logs
where event in ('supabase_error', 'auth_error', 'stripe_error')
  and occurred_at > now() - interval '7 days'
order by occurred_at desc;

-- ─── Helpful view for active users (last 30 days) ────────────────────────────

create or replace view public.active_users_summary as
select
  user_id,
  band_id,
  count(*)                               as event_count,
  count(distinct session_id)             as session_count,
  min(occurred_at)                       as first_seen,
  max(occurred_at)                       as last_seen,
  count(*) filter (where event = 'song_added')        as songs_added,
  count(*) filter (where event = 'gig_created')       as gigs_created,
  count(*) filter (where event = 'pdf_exported')      as pdfs_exported,
  count(*) filter (where event = 'supabase_error')    as errors_encountered
from public.user_activity_logs
where occurred_at > now() - interval '30 days'
  and user_id is not null
group by user_id, band_id
order by last_seen desc;
