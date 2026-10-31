Member wallpaper choice checks

Run the DOM integration test with Node.js and jsdom 26:
  npm install --no-save jsdom@26
  node tests/member-choices.cjs

The PostgreSQL test uses a rollback-only transaction and six published catalog entries.
Run tests/member-choices.sql after catalog activation. It leaves no test user or selections.
It verifies quota constraints, immutable choices, cross-account isolation, and selected-only private storage access.

Release order
1. Apply the base schema.
2. Upload approved originals to the private member-wallpapers bucket and verify SHA-256 readbacks.
3. Apply the guarded activation migration; it refuses to activate missing originals.
4. Run the PostgreSQL test, deploy the frontend, and verify the live gallery/account pages.
5. Disable the temporary importer and remove its temporary credential.

Originals and privileged credentials must never be committed to this repository.

Paid collection checks
  node --test tests/paid-checkout.test.mjs
  node tests/paid-store.cjs

Run tests/paid-checkout.sql as administrator against the prepared schema. It rolls
back all fixtures. The HTTP tests use mock PayPal responses; they do not make
charges or replace the sandbox end-to-end checks in docs/paypal-launch.md.
