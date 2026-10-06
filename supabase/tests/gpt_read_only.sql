begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000003');
insert into public.workout_records(user_id,kind,id,payload) values ('00000000-0000-4000-8000-000000000003','sessions','synthetic','{"id":"synthetic","revision":"r1"}');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"client_id":"synthetic-gpt-client"}', true);
do $$ begin
  if (select count(*) from public.workout_records) <> 1 then raise exception 'OAuth owner read denied'; end if;
  begin
    perform public.write_workout_record('00000000-0000-4000-8000-000000000003', 'sessions', 'synthetic', '{"id":"synthetic","revision":"r2"}', 1);
    raise exception 'OAuth RPC write must fail';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{}', true);
do $$ begin
  if not (public.write_workout_record('00000000-0000-4000-8000-000000000003', 'sessions', 'synthetic', '{"id":"synthetic","revision":"r2"}', 1) ->> 'ok')::boolean then raise exception 'Normal app writes regressed'; end if;
end $$;
rollback;
