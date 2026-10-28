Member wallpaper choice checks

Run the DOM integration test with Node.js and jsdom 26:
  npm install --no-save jsdom@26
  node tests/member-choices.cjs

The PostgreSQL test uses a rollback-only transaction and six existing catalog entries.
Run on the staged database before catalog activation; it leaves no test user or selections.

Release status
- Base schema applied and PostgreSQL isolation/quota test passed.
- Frontend integration test passed.
- 47 new originals still await approved upload to the existing private member-wallpapers bucket.
- Activation migration has not been applied; production still offers its original six files.
- Upload, verify all SHA-256 readbacks, apply activation migration, deploy frontend, and verify authenticated selected/unselected storage access before release completion.
- No credentials or original artwork files belong in this repository.
