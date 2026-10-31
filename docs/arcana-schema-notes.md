# Arcana database draft — local only

Status: **executed successfully in local PGlite 0.5.14 PostgreSQL/WASM**, with synthetic auth users and mock `auth.uid()` / `auth.jwt()` helpers. Transactional SQL fixtures rolled back, and a post-test query confirms synthetic USD prices did not remain. This is real PostgreSQL SQL execution, not a deployed Supabase integration or multi-process concurrency test. No remote user rows, credentials or database were accessed.

Supabase CLI 2.122.0 was subsequently installed in local test tooling. `migration new --help` was read and the CLI generated `supabase/migrations/20261031154849_arcana_readings.sql`; it is byte-identical to the reviewed draft. Default CLI home was read-only, so a fresh permitted `/tmp/arcana-supabase-home` was used. Migration was **not applied remotely**. Run advisors and provider sandbox checks after deployment authorization.

## Contract (coordinated with backend)

- `reserve_arcana_order(p_user uuid,p_request_key text,p_sku text,p_environment text,p_question jsonb,p_market text default 'tw')`
- `reserve_arcana_daily(p_user uuid,p_question jsonb,p_market text default 'tw')`
- `bind_arcana_payment(p_order uuid,p_provider text,p_provider_order text,p_merchant_id text)`
- `record_arcana_payment(p_order uuid,p_event_id text,p_provider text,p_provider_order text,p_capture text,p_state text,p_merchant_id text,p_amount_minor integer,p_currency text)`
- `fulfill_arcana_order(p_order uuid,p_result jsonb)`

Every RPC returns the canonical `arcana_orders` composite row; every RPC is SECURITY INVOKER and service-role-only. The authenticated backend derives p_user from verified authentication, never from an arbitrary body field, and checks row ownership before binding/payment/fulfillment. `question` is the validated snapshot `{questionId,language,optionA?,optionB?}`; trusted server question-bank lookup supplies domain and intent. SQL restricts object/size; the backend validates its full shape and IDs.

Orders contain `id,user_id,sku,amount_minor,currency,market,environment,request_key,question,draw_seed,daily_day,status,provider,provider_order_id,provider_capture_id,merchant_id,result,created_at,updated_at`. `draw_seed` is immutable DB-generated UUID and never granted for direct client reads. Do not return it in API responses. `result` is `{cards:[{id:0..77,reversed:boolean},...],reading:{...},reading_version:string}`. SQL checks 1/3/5 unique card IDs and orientation types; the server renderer derives the exact draw and positions from the stored seed and question. A second fulfillment returns the existing snapshot, never incoming replacement text.

## Currency and pricing

Market is independent of display language. `tw` maps to TWD 299 / 499 whole-dollar units. `global` maps to USD cents but both paid amounts remain NULL and disabled until the user confirms prices. No suggested USD figure has been inserted. Free daily uses 0 in the initial request's market currency; daily quota is shared across markets. A catalog composite foreign key binds the stored market/product/currency/amount, and only service reads are granted on the catalog. TW catalog provider remains NULL: PayPal binding is forbidden for TW, and a local provider still needs authorization and implementation. Global catalog specifies PayPal but paid prices remain disabled. SQL availability is not a payment launch switch: backend credentials, checkout-enabled gates and authorization still apply.

## Concurrency, retry and revocation

- Paid reservation locks `(user,environment)` then `(user,key)`; at most five creating/created/approved/pending orders are allowed per user/environment across markets. Existing-key retries return before the cap; paid, daily and closed orders do not count. Uncertain provider payments are never auto-expired: resume or reconcile existing orders. New cap errors are `arcana_pending_limit`. Paid reservation retry requires identical SKU, market, environment and question. New keys permit independent repeat purchases.
- Daily reservation locks `(user,server Asia/Taipei day)` and stores the first question plus seed before rendering. All later requests that day return it, even if language/market/question changes. Rendering failure does not burn the ability to retry; same seed and snapshot remain.
- Fulfillment and payment state updates lock the same order row. Refund/reversal hides the entire order from direct owner SELECT while retaining immutable results for audit. Revocation cannot be resurrected by stale completion. Revocation cannot erase data already delivered or downloaded.
- Event IDs are unique for PayPal; identical replay is harmless, a changed payload with the same ID fails. Refund before completion remains terminal. Reversal outranks refund. Decline/void cannot be revived.
- Backend must verify webhook signatures, retrieve authoritative provider details, and check payee, order custom ID/ownership, environment, exact currency and amount. SQL cannot itself verify the external signature. For partial refund events, backend must pass the verified original capture total, not the partial refunded amount, and conservatively revoke the affected reading.

## Verification and remaining checks

`tests/arcana-schema-runtime.mjs` bootstraps a disposable in-memory PostgreSQL with three roles, then executes the schema and tests. Run `node tests/arcana-schema-runtime.mjs` after installing the exact tests/package.json dependencies. `tests/arcana-schema.sql` contains rollback-only synthetic-user tests for prices, disabled USD, repeat orders, changed-key replay, immutable draw/result, duplicate cards, owner/outsider/anonymous access, denied client mutation/RPCs, daily reuse and refund replay. It executed successfully in the local WASM engine, including TW provider denial, cross-market daily reuse, direct service insert/result invariants, NULL result rejection and the five-order cap. Also run a real two-session race test for same daily and same paid idempotency key; SQL advisory locks, unique constraints and row locks are present but are not a substitute for runtime evidence.

No wallpaper tables or commerce RPCs are altered. No grants on existing schemas, tables or functions are broadened. Future account deletion needs an explicit retention/deletion policy; restrictive user foreign keys intentionally do not silently erase audit snapshots.

References checked: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html), [Supabase changelog](https://supabase.com/changelog). Markdown changelog endpoint returned unsupported content type; HTML fallback read. Recent timezone advisory concerned Vancouver/Edmonton/Casablanca, not Taipei; no related schema API change was identified in the reviewed entries.

The initial runtime failure was a duplicate provider argument in the test fixture, not a schema failure; it was corrected and the complete suite rerun successfully. Trigger guards cover both INSERT reservation state and first-result validation, not only the public RPC path. No service table DELETE privileges or event UPDATE privileges are granted.

Recovery detail: closing catalog sales blocks new reservations but does not block binding an already-created, independently verified provider order. Binding still enforces configured provider and global market. A transaction fixture disables sales between reservation and provider binding and verifies recovery succeeds.
