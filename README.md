# Privacy Choices

ShiftSC Fall 2026 Cyber Privacy challenge prototype. Review Google Maps, Quizlet,
or ChatGPT before visiting, compare disclosed practices with local preferences,
and apply a narrowly verified browser-location control.

## Current Delivery

- The Chrome extension and private backend are implemented.
- Hosted endpoint: `https://shiftsc-privacy-choices.vercel.app/api/analyze`.
- The owner's OpenAI and Upstash credentials are configured in Vercel. Reviewers
  need only the hosted extension package and the private demo access token.
  A fresh local checkout still needs its own provider configuration.
- The backend analyzes small policy sections and checks proposed explanations
  against their cited passages in a separate model call. This is not a guarantee
  of semantic accuracy or a complete inventory of collected information.
- Browser QA uses clearly labeled synthetic policy responses. Real Chrome
  location settings are tested, but this is not live model or account proof.
- Five official source snapshots are included; see `data/SOURCE_STATUS.md`.

## Install

Download the ready-made extension ZIP and showcase PDF from the repository's
**Releases** page. Extract the extension ZIP, then load its folder in desktop
Chrome using `chrome://extensions` -> Developer mode -> Load unpacked.
Enter the private demo token supplied separately by the owner.

The public download does not include access credentials. A reviewer does not
need their own OpenAI account or a local server.

Use Node.js 22 to build the hosted extension from a fresh clone:

```sh
npm ci
API_BASE=https://shiftsc-privacy-choices.vercel.app npm run package
```

Extract `dist/privacy-choices-extension.zip`, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select the extracted folder that
contains `manifest.json`. Open Privacy Choices from the extension toolbar.

Enter the owner's private demo token in the extension's settings.
It is not your OpenAI key. Share it privately, never in a public PDF or repository.
Provider keys must never be placed in the extension. Once the hosted package is
built, reviewers do not need Node.js or a local server. A locally generated token
does not authenticate to the owner's hosted deployment.

## Activate the Backend

1. Add `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, and
   `UPSTASH_REDIS_REST_TOKEN` to `.env.local`. This file is ignored and excluded
   from deployments. Use a dedicated API project; billing alerts are not the
   application's hard cap.
2. Create a persistent Upstash Redis instance with no eviction of the spending
   key, then configure the same variables as **Production** environment variables
   in your Vercel project, including `DEMO_ACCESS_TOKEN`. Do not overwrite a
   running demo's token unless you intend to revoke its reviewers' access.
3. Deploy with `vercel deploy --prod` to your own project.
4. Run `node --env-file=.env.local scripts/verify-hosted.mjs`. It checks
   authentication and all three services; uncached analyses make paid extraction
   and review calls within the reserved allowance. `SERVICE_IDS=quizlet,chatgpt`
   limits a focused check to those services without claiming Maps was tested.
5. Run `node --env-file=.env.local scripts/hosted-extension-check.mjs` after
   packaging, then inspect the explanations and their evidence. Passing transport,
   schema, and browser checks alone does not establish semantic correctness.

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
- Every available source is split into consecutive sections of at most 8,000
  UTF-8 bytes, with adjacent sentence context. Nothing is silently truncated.
  The 32-section ceiling fails explicitly if a source cannot fit.
- Each section yields at most three candidate findings. The server resolves
  sentence ranges to intact quotations; another model call checks each field,
  affirmative collection, and desktop-browser applicability against the cited
  passage and its immediate neighbors. Unsupported candidates are excluded.
- If a collection fact is supported but its purpose, condition, or retention
  detail is not, that detail is replaced with an explicit unknown. An unknown
  purpose remains unresolved even when all listed preference options are accepted.
- Whole-sentence matching proves quotation integrity, **not semantic entailment**.
  A second AI judgment can also be wrong. Excluded findings and source gaps are
  disclosed; missing findings are not evidence that information is not collected.
- Three sections run at a time. Any failed or refused section stops the analysis
  without publishing partial findings or automatically retrying the provider.
  Completed section checks and complete analyses are cached by content/version
  for seven days, so a later user-initiated attempt can reuse completed work.
- The $5 allowance reserves $0.02 before **each** extraction or review call.
  Reservations persist even when calls fail. The existing ledger is retained,
  including all earlier $0.07 reservations; it is never reset by deployment.
  With an empty ledger, at most 250 small calls fit. A review uses multiple calls.
- Each call is bounded to <=32,000 UTF-8 request bytes and <=4,000 output tokens
  (<=1,800 for review). The reservation includes message-overhead margin at the
  documented September 11, 2026 prices of $0.25/M input and $2/M output tokens.
  Recheck prices before reactivating a later demo. Hosting/storage charges are
  separate; no paid infrastructure upgrades were authorized.
- Provider calls time out after 75 seconds, section work after 160 seconds, and
  the extension after 210 seconds. The Vercel function limit is 240 seconds.
  Initial reviews may take over a minute; cached results avoid new model calls,
  but source retrieval still runs to check the content hash.
- Google Maps: the native geolocation rule covers all `https://www.google.com/*`
  pages in the regular profile, persists until removed, and does not hide IP
  location, typed addresses, prior data, or downstream uses.
- Quizlet and ChatGPT choices are guided, not automated account changes.
  User-reported changes remain unresolved. All/None express preferences and never
  grant browser or account permissions.
- External source/help links require confirmation. Declining a visit stays in the
  extension. No claim that leaving erases information collected earlier.

## Evidence and Showcase

[DECISIONS.md](DECISIONS.md) preserves the product choices.
[The two-page showcase](docs/Privacy_Choices_ShiftSC_Showcase.pdf) explains the
implementation and rationale; [the security review](docs/SECURITY_REVIEW.md)
records the publication checks and their limits.
The PDF builder is `scripts/build-showcase.py`; local regeneration writes
`output/pdf/Privacy_Choices_ShiftSC_Showcase.pdf`. Its screenshots must come from
the real browser check and retain the fixture label while live analysis is not
verified. Update evidence before regenerating. Local QA outputs and private
workflow notes are not distributed in this repository.

## Design Refinement

The current extension bundles Geist (SIL OFL) without remote font requests, places
the service lookup before preferences on narrow screens, and keeps supporting
policy details expandable. Keyboard focus and expanded evidence survive browser
verification refreshes. Loading motion respects reduced-motion preferences.

The browser check covers desktop and narrow layouts, text fit, keyboard focus,
local fonts, and reduced motion. `scripts/compare-design.py` is an optional local
comparison tool and needs separately supplied design reference images.
The PDF uses the local static Geist files in `data/fonts/`; its screenshots remain
explicitly fixture-backed until actual live analysis has been verified.
