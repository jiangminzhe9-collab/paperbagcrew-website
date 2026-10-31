# DZ ARCANA — existing-site integration, not deployed

## Targets and observed baseline

- Existing Paperbag Crew repository: `jiangminzhe9-collab/paperbagcrew-website`, baseline `2ec03c9763fec1a3d18f29f391369c0d05203ccc`.
- Canonical application: `https://paperbagcrew.com/arcana/readings/`.
- Paperbag Crew entrance: `?market=global&lang=en` (USD).
- Dongze entrance: `?market=tw&lang=zh-Hant` (TWD), from the separate Dongze homepage patch. Market is not inferred from language. The visitor is sent to the canonical domain for the existing account session; no cross-domain automatic login is claimed.
- Existing Supabase project: `yliacgixfhjhgjemvbpg`. Existing `paperbag-payments` v2 and all wallpaper commerce remain unchanged.
- Baseline Cloudflare Workers production build succeeded for the stated commit. A main-branch push can affect the live site; this local code is not a deployment.

## Implemented flow

The public frontend contains questions, explicitly assigned examples and artwork references, not the complete paid reading engine. It uses the existing Supabase account SDK with a dedicated adapter, avoiding the old homepage redirect. Account callbacks retain only whitelisted Arcana market/language return parameters.

The new `arcana-service` verifies member JWTs through Supabase Auth, rejects anonymous/unverified accounts, and owns prices, card draws and result creation. The content is prepared beforehand: no runtime AI, external model key or per-reading model call.

A free daily order reserves a database-generated seed and the server's Asia/Taipei date. A unique account/day constraint is shared by both markets. Retries use the same seed; language switches use the two saved language versions, not a new draw.

Paid requests reserve immutable question/market/product/price and an idempotency key before contacting a provider. New keys allow repeat purchases. Provider captures are checked against amount, currency, merchant, local invoice, SKU and owner-bound order. A successful payment produces one immutable result snapshot; refund/reversal hides it. Duplicate callbacks, lost responses and fulfillment failures do not create another charge or another draw. Paid-but-unfinished webhook fulfillment returns 503 for provider retry. Five unfinished orders per member/environment is a safety cap, not a lifetime purchase limit. An old uncertain checkout is held for manual review rather than recreated.

## Pricing and provider state — do not enable by assumption

- Dongze/TW: 3 cards NT$299, 5 cards NT$499. TWD provider amounts are whole units.
- Paperbag Crew/global: currency USD; **the user's exact USD prices remain unconfirmed**. Both amounts are NULL/disabled. Test-only synthetic USD values are rolled back and are not product prices.
- Global provider policy is PayPal. TW has no configured provider and is hard-blocked from PayPal checkout/capture/redirect, irrespective of environment flags. No NewebPay adapter, merchant activation or credential setup is represented as complete.
- PayPal Taiwan's official guidance limits Taiwan-account sending to cross-border payments. It cannot be assumed to solve Taiwan-to-Taiwan checkout: https://www.paypal.com/tw/cshelp/article/how-do-i-send-payments-help293?locale.x=en_TW
- Currency formats: https://developer.paypal.com/api/codes/currency/

## Public versus private deployment sources

The GitHub repository is public. Never push these files to it:

- `supabase/functions/arcana-service/content.mjs` — complete original card/question/detail library.
- `supabase/functions/arcana-service/engine.mjs` — complete combination engine.
- `supabase/functions/arcana-service/renderer.mjs` — private content adapter.

They are explicitly ignored by `.gitignore`; the separate public-file manifest/patch also excludes them. `.assetsignore` already excludes all `supabase/`, `tests/` and `docs/` files from static hosting.

A private function bundle contains these dependencies plus `index.ts`, `index.mjs` and `core.mjs`. The connected Supabase deployment tool supports inline named source files and can deploy this bundle without a public source push or new repository. Its endpoint is public, but source files are not served by that endpoint; member routes still require verified authentication. Fixed public examples are intentionally shareable.

## Local verification

Install exact test dependencies under the excluded tests directory: `npm ci --prefix tests`. Restore the three private ignored source files from the owner's private bundle before renderer tests. Run `npm test --prefix tests`.

The aggregate runs backend/renderer tests, existing wallpaper commerce tests, frontend/auth DOM tests, existing wallpaper-member tests and a real PostgreSQL/WASM PGlite execution of the schema/security SQL. PGlite uses mock Supabase auth helpers and synthetic users; it is not a live project test. Tests send no emails, real payments or production writes.

Still required before release: browser desktop/mobile checks, real Supabase Auth/API/RLS integration and two-connection concurrency/time-boundary checks, actual sandbox payment/cancellation/refund and webhook delivery, and confirmation of merchant receiving eligibility. No browser visual or real payment pass is implied by the local tests.

## Approval-dependent rollout (not executed)

1. Review current remote heads again; apply the narrow frontend/auth-entry changes without overwriting concurrent wallpaper work. Keep full content private.
2. Approve applying `20261031154849_arcana_readings.sql` to the existing Supabase project: new Arcana tables, owner RLS, service-only RPCs and immutable result/seed guards. Run actual database security advisors and controlled integration tests afterward.
3. Approve deploying only new `arcana-service` with the private dependency bundle. The mixed catalog/member/webhook function uses `verify_jwt=false` at the gateway because webhooks are not member JWTs; its body verifies member tokens and provider signatures. Do not weaken any existing function or policy.
4. The staged entrypoint is an explicit free-only build: it sets `ARCANA_SERVICE_ENABLED=true` and hardcodes `ARCANA_CHECKOUT_ENABLED=false` plus `ARCANA_LIVE_CHECKOUT_ENABLED=false`, regardless of pre-existing payment flags. It needs only the platform-provided Supabase environment, no new secrets or dashboard entry. Deploying this build after approval enables actual free daily readings/history, not checkout. A later paid release requires a separately reviewed source change; environmental flags cannot silently activate payments. Existing paid completion/refund handling is not disabled merely by pausing new sales.
5. For eventual PayPal sandbox testing, approve configuration of `ARCANA_PAYPAL_MODE`, `ARCANA_PAYPAL_CLIENT_ID`, `ARCANA_PAYPAL_CLIENT_SECRET`, `ARCANA_PAYPAL_MERCHANT_ID`, `ARCANA_PAYPAL_WEBHOOK_ID`, and `ARCANA_SANDBOX_USER_IDS`. Use existing authorized merchant credentials where appropriate; never put values in this repository, chat or screenshots. No new persistent credential is created by this code. Register the dedicated callback only after approval: `/functions/v1/arcana-service/webhook`.
6. Confirm exact USD prices, configure the matching immutable catalog/code, and complete real sandbox tests before enabling global sales. TW remains closed until an approved local provider is implemented and tested. No silent currency conversion or automatic USD price proposal is used.
7. Publish the reviewed public files to the existing site and the single Dongze entrance patch only with deployment approval. Review service/refund/support/privacy/retention terms before collecting paid customer questions. Support currently follows the existing public account address, `dongze.ltd@gmail.com`; no message is sent automatically.

No main push, deployment, external database change, secret value access, real account creation, payment, or email was performed in this implementation batch.

## Scope and rollback

The migration creates only new `arcana_catalog`, `arcana_orders`, `arcana_payment_events`, their guards/RPCs/policies and indexes. It does not rewrite existing member, wallpaper, commerce, Auth or Storage data. Its DDL is transactional. Frontend changes outside the new route are only the two Paperbag entry links, whitelisted account return handling and the new function's deployment configuration.

For an operational rollback, pause new Arcana service/checkouts, restore the prior reviewed frontend entry files, and retain the order database plus payment reconciliation/webhook handler for any outstanding orders. Do not drop records, disable existing wallpaper commerce, rotate/remove credentials or tell customers to pay again merely because a release is rolled back. Review and reconcile outstanding payments before retiring the handler. No automatic destructive rollback is included.
