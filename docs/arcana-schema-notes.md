# Arcana active schema — free daily and history only

Active migration: `supabase/migrations/20261031161156_arcana_free_daily_history.sql`.

This is a deliberately narrower release than the earlier full paid-commerce draft. The earlier database operation was not applied. Its migration is removed and the public draft is rewritten to this same free-only SQL; the full paid schema remains local/private future work. Do not apply future paid SQL to make a test pass.

## Two-table contract

`arcana_catalog` has six market/SKU placeholders: a free daily entry in each market and disabled three-/five-card placeholders. Every paid entry has NULL amount, NULL provider and `enabled=false`; schema constraints enforce those restrictions. The service role has read-only access. Client roles have no catalog access.

`arcana_orders` is a compatibility name for free history. Constraints require `sku='daily'`, `amount_minor=0`, `environment='internal'` and internal status `paid`. That status is not a real payment: no provider columns, provider event table or paid financial transaction exists. Market controls the zero-amount currency label only. Account/day uniqueness is shared across markets.

A reservation contains its owner, chosen language snapshot, DB-generated immutable draw seed, server Asia/Taipei day, timestamps and optional result. The saved result contains one card, its orientation, reading text/version and the renderer's two language versions. Language switching uses the same card. The DB validates one card ID in 0–77 and a boolean orientation, the result envelope and its size. The backend validates question inputs and renders the full bilingual structure.

## Service-only operations

- `reserve_arcana_daily(p_user uuid, p_question jsonb, p_market text default 'tw')`
- `fulfill_arcana_order(p_order uuid, p_result jsonb)`

Both return the canonical order row and use SECURITY INVOKER. Public, anonymous and authenticated roles cannot invoke them. The service role also receives the result-validation helper, but no payment RPC is created or granted.

The backend derives the member ID from a verified Auth token; it does not trust a client-supplied owner. Daily reservation takes an advisory transaction lock over member and server day. A unique member/day constraint backs it up. The first seed and language snapshot win; retries return that row even after a language or market change.

Fulfillment locks the row. A second fulfillment returns the existing result rather than replacing it. A trigger prohibits changing the reservation identity, amount, owner, question, seed, day or creation time and protects an already-written result. Direct insert cannot supply an existing result or a non-current server day. Service table DELETE is not granted and the trigger rejects deletion.

## RLS and privacy

RLS is enabled on both new tables. Authenticated non-anonymous members may select only their own daily history through the owner policy. The column grant omits `draw_seed`; client mutation and RPC execution are denied. Service access is restricted to catalog SELECT and daily row SELECT/INSERT/UPDATE plus the named RPCs. There is no broad grant on existing tables or schemas.

No existing wallpaper, commerce, Auth or Storage object is changed. The user foreign key does not silently cascade deletion of history. A future account-retention/deletion policy still needs explicit review.

## Validation boundaries

`tests/arcana-free-schema-runtime.mjs` runs the active free schema and `tests/arcana-free-schema.sql` against a disposable PGlite PostgreSQL engine with synthetic roles/users and mock Supabase auth helpers. This checks SQL behavior locally, not production migration success, real Auth integration, two-process concurrency or browser rendering. Verify production application and advisors independently.

The old full `arcana-schema.sql` and paid RLS edge tests are retained only as private/local future work and removed from the public release. `arcana-schema-runtime.mjs` is now a compatibility entrypoint to the free-only runtime tests. The earlier private draft is not deployed by this release. A passing mocked paid-service test does not mean those SQL functions exist or that checkout is enabled. The active free-only entrypoint hard-disables both payment activation flags.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html). Future payment implementation must re-check provider and database documentation before making changes.

## Hosted deployment verified — 2026-10-31

Existing project `yliacgixfhjhgjemvbpg`: successful hosted migration **20261031161313**, name `arcana_free_daily_history`. MCP assigned the hosted timestamp; local CLI-generated source is `20261031161156_arcana_free_daily_history.sql`, SHA-256 `725c4769bb2c24d43b27a96c2511ed4f33703c2da6c7364606c4ee5d9d496171`. This is one deployed migration, not two.

Hosted metadata checks confirmed both new tables have RLS, authenticated owner-only SELECT, no anon SELECT, no member INSERT/UPDATE or draw-seed SELECT, and no anon/member EXECUTE on the new functions. Daily/fulfillment/validator functions are SECURITY INVOKER with service-role EXECUTE. All paid catalog entries were false/NULL/NULL; payment-events table and paid RPCs are absent.

A hosted rollback-only role test confirmed authenticated daily-RPC invocation is denied and service-role NULL-user requests are rejected. No test user or reading was inserted. No secrets, payment configuration or existing commerce objects were changed. The first, broader migration submission was rejected; immediate checks confirmed no partial application before the materially reduced free-only migration succeeded.

Security advisor: catalog RLS with no policy is INFO and intentional service-only access. Pre-existing leaked-password protection disabled is WARN; this release did not change it. See [RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Additional local integration passed: `node tests/arcana-free-integration.mjs` uses a real PGlite reservation row, the production renderer, SQL fulfillment, and history retrieval. Deep equality checks confirm the saved bilingual snapshot and same-day cross-market/language retry preserve the original seed, cards and reading. This is not a real hosted member-login acceptance test or a multi-process race test.
