-- Apply only to a user-owned Supabase project. Contains no personal workout data.
begin;
create table public.workout_records (
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('sessions', 'sets', 'reports')),
  id text not null check (length(id) between 1 and 512),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version bigint not null default 1 check (version > 0),
  report_version bigint,
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

-- Per-account report numbering is independent of immutable device payloads.
create table public.workout_report_sequences (
  user_id uuid not null references auth.users(id),
  week_start text not null,
  last_version bigint not null check (last_version > 0),
  primary key (user_id, week_start)
);
alter table public.workout_report_sequences enable row level security;
revoke all on public.workout_report_sequences from anon, authenticated;

-- Refuse synchronization when owner isolation or write restrictions are missing.
create function public.workout_sync_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ready boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select c.relrowsecurity and
    not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') and
    pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') and
    not pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') and
    not pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') and
    not pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') and
    (select count(*) = 1 from pg_catalog.pg_policy p where p.polrelid = c.oid) and
    exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid and p.polname = 'records_owner_read'
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%auth.uid()%'
      and pg_catalog.pg_get_expr(p.polqual, p.polrelid) like '%user_id%')
  into ready from pg_catalog.pg_class c where c.oid = 'public.workout_records'::regclass;
  return pg_catalog.jsonb_build_object('contractVersion', 1, 'ready', coalesce(ready, false));
end;
$$;
revoke all on function public.workout_sync_status() from public, anon;
grant execute on function public.workout_sync_status() to authenticated;

-- Only this RPC writes. Direct client writes are denied, so they cannot bypass CAS.
create function public.write_workout_record(p_account_id uuid, p_kind text, p_id text, p_payload jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_row public.workout_records%rowtype;
  saved public.workout_records%rowtype;
  allocated bigint;
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
    return jsonb_build_object('ok', true, 'record', jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', current_row.payload, 'version', current_row.version, 'reportVersion', current_row.report_version));
  end if;
  if (p_kind = 'reports' and current_row.version is not null) or coalesce(current_row.version, 0) <> p_expected_version then
    return jsonb_build_object('ok', false, 'record', case when current_row.version is null then null else jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', current_row.payload, 'version', current_row.version, 'reportVersion', current_row.report_version) end);
  end if;
  if p_kind = 'reports' then
    if p_payload ->> 'weekStart' is null or p_payload ->> 'weekStart' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Report week required' using errcode = '22023';
    end if;
    insert into public.workout_report_sequences(user_id, week_start, last_version)
    values (uid, p_payload ->> 'weekStart', 1)
    on conflict (user_id, week_start) do update set last_version = workout_report_sequences.last_version + 1
    returning last_version into allocated;
  end if;
  insert into public.workout_records(user_id, kind, id, payload, version, report_version) values (uid, p_kind, p_id, p_payload, 1, allocated)
  on conflict (user_id, kind, id) do update set payload = excluded.payload, version = workout_records.version + 1, updated_at = now()
  returning * into saved;
  return jsonb_build_object('ok', true, 'record', jsonb_build_object('kind', p_kind, 'id', p_id, 'payload', saved.payload, 'version', saved.version, 'reportVersion', saved.report_version));
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
