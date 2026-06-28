-- Migration: add original year and genre to SetlistSongs
-- Both fields are AI-populated; no manual entry required.
-- original_year: the year the original recording was released (e.g. 1978)
-- genre:         broad style category (e.g. 'Pop', 'Jazz', 'R&B', 'Standards')

alter table "SetlistSongs"
  add column if not exists original_year smallint check (original_year > 1900 and original_year <= 2100),
  add column if not exists genre text;

-- Index to support filtering by genre in the songs screen
create index if not exists idx_songs_genre on "SetlistSongs" (band_id, genre);

-- Index for backfill queries ("songs without metadata yet")
create index if not exists idx_songs_missing_metadata
  on "SetlistSongs" (band_id, original_year, genre)
  where original_year is null or genre is null;

comment on column "SetlistSongs".original_year is
  'Year the original recording was released. Populated automatically via AI enrichment.';
comment on column "SetlistSongs".genre is
  'Broad genre/style of the song (e.g. Pop, Jazz, R&B, Rock, Standards). AI-populated.';
