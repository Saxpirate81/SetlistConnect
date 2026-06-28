-- Migration: add YouTube verification fields to SetlistSongs
-- Adds:
--   youtube_verified  boolean  — true once a human has confirmed the video match
--   youtube_video_id  text     — extracted video ID (e.g. "dQw4w9WgXcQ")
--                                stored alongside the existing youtube_url column
--
-- NOTE: The existing `audio_url` / `youtube_url` column stores the full URL.
--       `youtube_video_id` is a derived convenience field kept in sync by the app.
--       `youtube_verified = true` means a band member has confirmed this video
--       is the right one for this song.

alter table "SetlistSongs"
  add column if not exists youtube_verified boolean not null default false,
  add column if not exists youtube_video_id text;

-- Index for fast lookups of unverified songs (used by the verify queue)
create index if not exists idx_songs_youtube_verified
  on "SetlistSongs" (band_id, youtube_verified)
  where youtube_verified = false;

comment on column "SetlistSongs".youtube_verified is
  'True once a band admin or member has confirmed the YouTube video match for this song.';
comment on column "SetlistSongs".youtube_video_id is
  'YouTube video ID (e.g. dQw4w9WgXcQ). Kept in sync with audio_url by the app.';
