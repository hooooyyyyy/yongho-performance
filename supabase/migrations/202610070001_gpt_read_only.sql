-- No data migration or deletion. Direct app sessions retain the existing CAS behavior.
begin;
create or replace function public.write_workout_record(p_account_id uuid, p_kind text, p_id text, p_payload jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_row public.workout_records%rowtype;
  saved public.workout_records%rowtype;
  allocated bigint;
begin
  -- OAuth agents may read but cannot bypass the read-only MCP surface through this RPC.
  if auth.jwt() ->> 'client_id' is not null then raise exception 'OAuth access is read only' using errcode = '42501'; end if;
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

commit;
