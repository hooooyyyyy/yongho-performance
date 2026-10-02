-- Apply only to a user-owned Supabase project. Contains no personal workout data.
begin;
create table public.workout_records (
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('sessions', 'sets', 'reports')),
  id text not null check (length(id) between 1 and 512),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id),
  check (payload ->> 'id' is not null and payload ->> 'id' = id),
  check (payload ->> 'revision' is not null)
);
alter table public.workout_records enable row level security;
revoke all on public.workout_records from anon, authenticated;
grant select on public.workout_records to authenticated;
create policy records_owner_read on public.workout_records for select to authenticated
  using ((select auth.uid()) = user_id);

-- Only this RPC writes. Direct client writes are denied, so they cannot bypass CAS.
create function public.write_workout_record(p_account_id uuid, p_kind text, p_id text, p_payload jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_row public.workout_records%rowtype;
  saved public.workout_records%rowtype;
begin
  if uid is null or uid <> p_account_id then raise exception 'Authentication/account mismatch' using errcode = '42501'; end if;
  if p_kind not in ('sessions', 'sets', 'reports') or p_id is null or p_payload is null or p_expected_version is null or p_expected_version < 0
    or p_payload ->> 'id' is distinct from p_id or p_payload ->> 'revision' is null then
    raise exception 'Invalid record envelope' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text || ':' || p_kind || ':' || p_id, 0));
  select * into current_row from public.workout_records where user_id = uid and kind = p_kind and id = p_id for update;
  -- A retry after an interrupted acknowledgement must be idempotent.
  if current_row.version is not null and current_row.payload = p_payload then
    return jsonb_build_object('ok', true, 'record', jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', current_row.payload, 'version', current_row.version));
  end if;
  if (p_kind = 'reports' and current_row.version is not null) or coalesce(current_row.version, 0) <> p_expected_version then
    return jsonb_build_object('ok', false, 'record', case when current_row.version is null then null else jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', current_row.payload, 'version', current_row.version) end);
  end if;
  insert into public.workout_records(user_id, kind, id, payload, version) values (uid, p_kind, p_id, p_payload, 1)
  on conflict (user_id, kind, id) do update set payload = excluded.payload, version = workout_records.version + 1, updated_at = now()
  returning * into saved;
  return jsonb_build_object('ok', true, 'record', jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', saved.payload, 'version', saved.version));
end;
$$;
revoke all on function public.write_workout_record(uuid, text, text, jsonb, bigint) from public, anon;
grant execute on function public.write_workout_record(uuid, text, text, jsonb, bigint) to authenticated;

create table public.workout_analyses (
  user_id uuid not null references auth.users(id),
  id uuid not null default gen_random_uuid(),
  contract_version integer not null default 1,
  status text not null check (status in ('pending', 'completed', 'failed')),
  session_ids text[] not null,
  input_revisions jsonb not null,
  model text,
  result jsonb,
  narrative text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.workout_analyses enable row level security;
revoke all on public.workout_analyses from anon, authenticated;
grant select on public.workout_analyses to authenticated;
grant select, insert, update on public.workout_analyses to service_role;
create policy analysis_owner_read on public.workout_analyses for select to authenticated
  using ((select auth.uid()) = user_id);
commit;
