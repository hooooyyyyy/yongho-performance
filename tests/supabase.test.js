import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('PostgreSQL migration, RLS and CAS protect two accounts and deny anonymous access', async () => {
  const db = new PGlite()
  // Reproduce Supabase roles/auth.uid in an isolated PostgreSQL runtime; no hosted project is contacted.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`)
  await db.exec(await readFile(new URL('../supabase/migrations/202610020001_workout_sync.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../supabase/tests/workout_rls.sql', import.meta.url), 'utf8'))
  await db.close()
})
