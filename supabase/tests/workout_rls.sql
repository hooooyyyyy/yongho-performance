-- Run after the migration in a disposable database/Supabase SQL session; every fixture rolls back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into public.workout_analyses(user_id, status, session_ids, input_revisions, narrative)
values ('00000000-0000-4000-8000-000000000001', 'completed', array['sample'], '{}', 'Synthetic analysis');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare response jsonb;
begin
  response := public.write_workout_record('00000000-0000-4000-8000-000000000001', 'sessions', 'sample', '{"id":"sample","revision":"r1","journal":"Synthetic A"}', 0);
  if not (response ->> 'ok')::boolean or (response #>> '{record,version}')::int <> 1 then raise exception 'first write failed'; end if;
  response := public.write_workout_record('00000000-0000-4000-8000-000000000001', 'sessions', 'sample', '{"id":"sample","revision":"r1","journal":"Synthetic A"}', 0);
  if not (response ->> 'ok')::boolean or (response #>> '{record,version}')::int <> 1 then raise exception 'retry duplicated'; end if;
  response := public.write_workout_record('00000000-0000-4000-8000-000000000001', 'sessions', 'sample', '{"id":"sample","revision":"r2","journal":"Synthetic edit"}', 1);
  if (response #>> '{record,version}')::int <> 2 then raise exception 'version not incremented'; end if;
  response := public.write_workout_record('00000000-0000-4000-8000-000000000001', 'sessions', 'sample', '{"id":"sample","revision":"r3"}', 1);
  if (response ->> 'ok')::boolean or response #>> '{record,payload,revision}' <> 'r2' then raise exception 'stale version overwrote data'; end if;
  if (select count(*) from public.workout_records) <> 1 then raise exception 'owner read failed'; end if;
  if (select count(*) from public.workout_analyses) <> 1 then raise exception 'owner analysis read failed'; end if;
  begin
    update public.workout_records set payload = '{"id":"sample","revision":"bypass"}';
    raise exception 'direct update must be denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.workout_records(user_id,kind,id,payload) values ('00000000-0000-4000-8000-000000000001','sets','bypass','{"id":"bypass","revision":"x"}');
    raise exception 'direct insert must be denied';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.workout_records;
    raise exception 'direct delete must be denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.workout_analyses(user_id,status,session_ids,input_revisions) values ('00000000-0000-4000-8000-000000000001','pending',array['sample'],'{}');
    raise exception 'client analysis write must be denied';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.workout_records) <> 0 then raise exception 'other account read leaked'; end if;
  if (select count(*) from public.workout_analyses) <> 0 then raise exception 'other account analysis leaked'; end if;
  begin
    perform public.write_workout_record('00000000-0000-4000-8000-000000000001','sessions','sample','{"id":"sample","revision":"other"}',2);
    raise exception 'other account write must be denied';
  exception when insufficient_privilege then null; end;
  perform public.write_workout_record('00000000-0000-4000-8000-000000000002','sessions','sample','{"id":"sample","revision":"own"}',0);
  if (select count(*) from public.workout_records) <> 1 then raise exception 'same logical ID in separate accounts failed'; end if;
end;
$$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform count(*) from public.workout_records;
    raise exception 'anonymous read must be denied';
  exception when insufficient_privilege then null; end;
  begin
    perform public.write_workout_record('00000000-0000-4000-8000-000000000001','sessions','sample','{"id":"sample","revision":"anon"}',2);
    raise exception 'anonymous RPC must be denied';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
