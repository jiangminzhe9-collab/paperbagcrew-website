import { createHandler } from './index.mjs';
import { renderReading, validateQuestion } from './renderer.mjs';

// Explicit first-release build: actual member daily readings and saved history.
// Deploy only after approval. No payment activation is possible through flags.
const FREE_ONLY = Object.freeze({
  ARCANA_SERVICE_ENABLED: 'true',
  ARCANA_CHECKOUT_ENABLED: 'false',
  ARCANA_LIVE_CHECKOUT_ENABLED: 'false',
});
const environment = (name: string) => Object.prototype.hasOwnProperty.call(FREE_ONLY, name)
  ? FREE_ONLY[name as keyof typeof FREE_ONLY]
  : Deno.env.get(name);
Deno.serve(createHandler(environment, fetch, { renderReading, validateQuestion }));
