create or replace function public.claim_musician_memberships_for_current_user()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_inserted integer := 0;
begin
  if v_user_id is null or v_email = '' then
    return 0;
  end if;

  insert into public.band_memberships (band_id, user_id, role, status, musician_id)
  select distinct
    musician.band_id,
    v_user_id,
    'member',
    'active',
    musician.id
  from public."SetlistMusicians" musician
  where lower(trim(coalesce(musician.email, ''))) = v_email
    and musician.deleted_at is null
    and not exists (
      select 1
      from public.band_memberships existing
      where existing.band_id = musician.band_id
        and existing.user_id = v_user_id
        and existing.status = 'active'
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.claim_musician_memberships_for_current_user() to authenticated;
