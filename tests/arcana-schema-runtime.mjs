import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
try {
 await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.jwt(),auth.uid() TO anon,authenticated,service_role;`);
 await db.exec(await readFile(new URL('../docs/arcana-schema-draft.sql', import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./arcana-schema.sql', import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('./arcana-rls-edges.sql', import.meta.url),'utf8'));
 const production = await db.query("select count(*)::int n from public.arcana_catalog where market='global' and sku<>'daily' and (enabled or amount_minor is not null)");
 if(production.rows[0].n!==0) throw new Error('Synthetic test USD prices escaped rollback');
 console.log('PASS actual PostgreSQL/WASM: Arcana schema + transactional role/RLS/security fixtures. Mock auth helpers only; no remote DB.');
} catch (error) { console.error('SQL FAIL:', error.message, error.where || ''); process.exitCode=1; } finally { await db.close(); }
