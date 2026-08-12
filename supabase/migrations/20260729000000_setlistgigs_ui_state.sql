-- Persist per-gig builder UI layout (section order, build checklist, hidden sections)
-- so layout stays consistent across devices/logins instead of localStorage-only.

alter table "SetlistGigs"
  add column if not exists ui_state jsonb not null default '{}'::jsonb;

comment on column "SetlistGigs".ui_state is
  'Builder UI layout: buildComplete, sections, hiddenSections, hiddenSpecial, sectionStyles';
