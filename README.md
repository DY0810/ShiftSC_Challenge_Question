# Privacy Choices

ShiftSC Fall 2026 Cyber Privacy challenge prototype. Review Google Maps, Quizlet,
or ChatGPT before visiting, compare disclosed practices with local preferences,
and apply a narrowly verified browser-location control.

## Current Delivery

- The Chrome extension and private backend are implemented.
- Hosted endpoint: `https://shiftsc-privacy-choices.vercel.app/api/analyze`.
- Live AI analysis is **not activated** until the OpenAI and Upstash values below
  are configured. The endpoint rejects unauthenticated requests and returns an
  explicit setup error for authenticated requests while storage is missing.
- Browser QA uses clearly labeled synthetic policy responses. Real Chrome
  location settings are tested, but this is not live model or account proof.
- Five official source snapshots are included; see `data/SOURCE_STATUS.md`.

## Install

Extract `dist/privacy-choices-extension.zip`, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select the extracted folder that
contains `manifest.json`. Open Privacy Choices from the extension toolbar.

Enter the private `DEMO_ACCESS_TOKEN` from `.env.local` in the extension's settings.
It is not your OpenAI key. Share the reviewer token privately, never in a public PDF
or repository. Provider keys must never be placed in the extension.

## Activate the Backend

1. Add `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, and
   `UPSTASH_REDIS_REST_TOKEN` to `.env.local`. This file is ignored and excluded
   from deployments. Use a dedicated API project; billing alerts are not the
   application's hard cap.
2. Create a persistent Upstash Redis instance with no eviction of the spending
   key, then configure the same variables as **Production** environment variables
   in this Vercel project. Do not overwrite the existing private demo token.
3. Redeploy with `vercel deploy --prod --scope dongyeop-7926s-projects`.
4. Run `node --env-file=.env.local scripts/verify-hosted.mjs`. An authenticated
   check can make one paid model request after setup, within the reserved budget.
5. Re-run the model tests on all three services before calling the demo fully
   verified; regenerate the PDF if the live-verification status changes.

The backend needs a real Redis service, not a per-function in-memory substitute.
Do not delete/reset `shiftsc:privacy:budget:v1` or replace its database while this
demo is active: that would reset the total allowance.

## Local Development and Checks

```sh
npm ci
node scripts/setup-local.mjs
npx playwright install chromium
npm test
npm run test:browser
npm run dev
```

Load the source `extension/` directory for local development; its backend is
`http://127.0.0.1:4317`. The ordinary browser preview shows the actual interface
but cannot use extension storage or browser controls.

```sh
API_BASE=https://shiftsc-privacy-choices.vercel.app npm run package
npm run check
node scripts/source-probe.mjs
```

The atomic-budget integration check uses `redis-server` and `redis-cli` on an
isolated temporary Unix socket. It reports a skip if Redis is not installed.
Browser evidence lives in `output/qa/`. Tests use a temporary extension copy with
`contentSettings` pregranted for the granted-permission case; the distributed
manifest leaves that permission optional. Permission denial is covered separately
by helper tests. The confirmed Maps visit may reach Google from the isolated test
profile; requests before confirmation must not.

## Architecture and Boundaries

- MV3 extension: native HTML/CSS/JavaScript, local storage, optional
  `contentSettings`, one permitted backend origin. No history monitoring or
  content scripts.
- `POST /api/analyze` accepts only `{ "serviceId": "maps" }` (or `quizlet`,
  `chatgpt`) with a bearer demo token. Extra fields and unknown services fail.
- Sources are fixed official URLs. Retrieval tries direct HTTPS, an anonymous
  public reader, then a source-identified dated snapshot. No paid reader API.
  Denied, partial, warning-bearing, or malformed sources fail closed.
- OpenAI Responses uses `gpt-5-mini`, strict JSON output, no tools, and
  `store: false`. Only public policy content goes to the model, never preferences,
  user URLs, account cookies, or conversations. This does not promise zero provider
  retention or no infrastructure metadata.
- Whole-sentence matching checks quotation integrity, **not semantic entailment**.
  Model summaries, categories, retention interpretations, and purposes can still
  be wrong. The UI labels them AI interpretations and shows policy evidence.
- The $5 application allowance reserves $0.07 before each model attempt; at most
  71 attempts reserve $4.97. Reservations persist even if a model call times out.
  Identical concurrent analyses use a distributed lock and content-hash cache.
- The bound uses <=180,000 UTF-8 request bytes, <=8,000 output tokens, and the
  documented September 11, 2026 prices of $0.25/M input and $2/M output tokens.
  Recheck prices before reactivating a later demo. Hosting/storage charges are
  separate; no paid infrastructure upgrades were authorized.
- Google Maps: the native geolocation rule covers all `https://www.google.com/*`
  pages in the regular profile, persists until removed, and does not hide IP
  location, typed addresses, prior data, or downstream uses.
- Quizlet and ChatGPT choices are guided, not automated account changes.
  User-reported changes remain unresolved. All/None express preferences and never
  grant browser or account permissions.
- External source/help links require confirmation. Declining a visit stays in the
  extension. No claim that leaving erases information collected earlier.

## Evidence and Showcase

`WORKFLOW.md` records gates and handoff; `DECISIONS.md` preserves user choices.
The PDF builder is `scripts/build-showcase.py`; the final two-page result is
`output/pdf/Privacy_Choices_ShiftSC_Showcase.pdf`. Its screenshots must come from
the real browser check and retain the fixture label while live analysis is not
verified. Update evidence before regenerating.

## Design Refinement

The current extension bundles Geist (SIL OFL) without remote font requests, places
the service lookup before preferences on narrow screens, and keeps supporting
policy details expandable. Keyboard focus and expanded evidence survive browser
verification refreshes. Loading motion respects reduced-motion preferences.

`design-qa.md` records the original Figma reference, the independent lookup target,
normalized before/after comparisons, accepted deviations, and final QA results.
Run `scripts/compare-design.py` after browser QA to regenerate comparison images.
The PDF uses the local static Geist files in `data/fonts/`; its screenshots remain
explicitly fixture-backed until actual live analysis has been verified.
