-- Migration: ensure AI metadata columns exist on the canonical songs table.
-- The app reads/writes song rows from "SetlistSongs" (not "songs").

alter table "SetlistSongs"
  add column if not exists original_year smallint check (original_year > 1900 and original_year <= 2100),
  add column if not exists genre text,
  add column if not exists youtube_verified boolean not null default false,
  add column if not exists youtube_video_id text;

create index if not exists idx_setlistsongs_genre
  on "SetlistSongs" (band_id, genre);

create index if not exists idx_setlistsongs_missing_metadata
  on "SetlistSongs" (band_id, original_year, genre)
  where original_year is null or genre is null;

create index if not exists idx_setlistsongs_youtube_verified
  on "SetlistSongs" (band_id, youtube_verified)
  where youtube_verified = false;
