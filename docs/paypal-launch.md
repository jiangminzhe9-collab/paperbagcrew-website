# City Sessions paid download rollout

Current release prepares checkout; **new paid sales remain closed**. The original PayPal coffee link and the six permanent free wallpaper choices are unchanged.

Product: `city-sessions-vol-01`, US$4.99 once, 12 original PNGs plus setup instructions and file guide. Same artwork remains eligible for free member choices; the purchase is the complete ZIP without using those choices. No subscription, 4K claim, physical shipping or commercial license.

## Deployed components

- Supabase project: `yliacgixfhjhgjemvbpg` (existing Paperbag Crew project).
- Edge Function: `paperbag-payments`, own member JWT verification against Auth; signed PayPal webhook verification. Gateway JWT verification is disabled because the same handler receives public catalog and PayPal webhook requests.
- Database migration: `20261031144455_paid_city_sessions.sql`.
- Private bucket `paid-downloads`; no browser read policies. Downloads use a server-verified paid order and a 120-second signed URL.
- File: `city-sessions-vol-01/Paperbag-Crew-City-Sessions-Vol-01.zip`, 29,291,167 bytes.
- SHA-256: `5a8e5b90718e5c35e90b7c501fb4ef901543f5f104102a13e6f4296379135f1e`.
- Import uploaded and verified a storage readback, then set `file_ready=true`. The temporary importer was retired to HTTP 410 with gateway JWT verification restored. Its one-time credential was removed.
- `commerce_products.enabled=false`. No real orders were created during implementation. The database security tests roll back all fixtures.

## Secure configuration still required

Use the authenticated PayPal Developer dashboard and the Supabase Edge Function Secrets dashboard. Never put secrets in this repository, static HTML, screenshots or chat.

1. Create a dedicated PayPal REST app for Paperbag Crew. Start with sandbox credentials.
2. In Supabase configure `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID`, and `PAYPAL_SANDBOX_USER_IDS` (comma-separated UUIDs of deliberate test members). The merchant ID must belong to the seller account for that environment.
3. Register this app webhook:
   `https://yliacgixfhjhgjemvbpg.supabase.co/functions/v1/paperbag-payments/webhook`
   Subscribe to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`.
4. A valid signed-in allowlisted tester sees sandbox checkout at `/shop/city-sessions-vol-01/checkout/`. Everyone else stays closed. Keep `PBC_LIVE_CHECKOUT_ENABLED` unset/false and the product disabled.
5. Test an actual sandbox purchase, buyer cancellation, declined funding, pending payment, duplicate callback, browser closed after approval, member sign-out/in and second-device re-download, and refund/reversal delivery. Verify ZIP SHA-256 and member isolation. Simulator-only mock webhooks cannot be verified by PayPal's postback verification endpoint; use actual sandbox transactions.
6. Configure live app credentials, merchant ID and a separately registered live webhook, with `PAYPAL_MODE=live`. Remove sandbox test-user IDs when testing is finished. Confirm merchant account eligibility and successful receiving setup. Taiwan PayPal cannot receive domestic payments from Taiwan PayPal accounts.
7. Only after integration tests and any explicitly authorized live transaction checks, enable both `PBC_LIVE_CHECKOUT_ENABLED=true` and `commerce_products.enabled=true` for this SKU. Update the product/shop Coming soon copy in the same release. A non-working checkout must never be presented as open.

Dashboard links:
- https://developer.paypal.com/dashboard/applications
- https://supabase.com/dashboard/project/yliacgixfhjhgjemvbpg/functions/secrets

## Reconciliation and support

PayPal prices, merchant IDs, currencies, invoice IDs, SKU and order ownership are checked server-side. Reserve and capture calls use stable idempotency keys. A unique partial index prevents a second open/paid purchase of the same product per member/environment. Refunds and reversals cannot be undone by a stale completion event. The account page displays order references and a Check / resume purchase link.

Creating records older than five hours without a saved PayPal ID are blocked for manual review, rather than recreating an ambiguous transaction beyond the default idempotency window. Investigate the invoice ID in PayPal before marking one voided. Never discard an uncertain order or instruct the customer to pay again without checking it.

Refunds are reviewed/performed in PayPal; signed webhooks revoke download access. Pending payments do not give downloads. Already issued signed URLs expire within 120 seconds. Dispute lifecycle automation beyond capture refund/reversal events is not included in this first release; use PayPal's merchant notifications and review disputed orders before launch expansion.

To pause new sales, set the product `enabled=false` or `PBC_LIVE_CHECKOUT_ENABLED=false`. Existing approved orders can still finish and paid members can still download. Do not remove credentials while payments are outstanding. Do not disable or replace the coffee link when adding NewebPay later.

## Validation and limitations

- `node --test tests/paid-checkout.test.mjs`: mock-provider security, payment state, retry and delivery tests. These do **not** prove a real PayPal account can receive funds.
- `tests/paid-checkout.sql`: rollback-only RLS, RPC permissions, uniqueness, refund replay and closed-sales checks, run successfully against the actual database.
- `node tests/member-choices.cjs` with jsdom 26.1.0: existing 129-artwork free-choice flow regression.
- `node tests/paid-store.cjs` with jsdom 26.1.0: checkout and account DOM behavior.
- No real charge made. Sandbox end-to-end payment and browser visual QA still required before opening sales.
- Security Advisor: intentional deny-by-default RLS tables `commerce_products` and `commerce_webhook_events` have no client policies. Pre-existing leaked-password protection warning remains; see https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .

Backend source, tests, docs and environment files are excluded from Cloudflare static assets. The ZIP is not in GitHub.
