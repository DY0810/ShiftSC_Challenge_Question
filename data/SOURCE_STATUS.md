# Official Privacy Source Coverage

**Captured: 5/5. Blocked sources: 0. Methods: 2 direct, 2 browser, 1 reader.**

These snapshots use the exact five source IDs and URLs in `extension/catalog.js`.
Capture timestamps are actual UTC response-receipt or rendered-DOM capture times, not policy effective dates.

| Source ID | Method | Captured at (UTC) | Normalized text bytes |
| --- | --- | --- | ---: |
| `google-privacy` | direct | 2026-09-11T01:51:38.636Z | 64,078 |
| `google-location` | direct | 2026-09-11T01:51:38.879Z | 27,243 |
| `quizlet-privacy` | browser | 2026-09-11T01:52:33.580Z | 49,810 |
| `openai-privacy` | browser | 2026-09-11T01:54:30.446Z | 27,678 |
| `openai-controls` | reader | 2026-09-11T01:51:38.639Z | 2,893 |

Total: 171,702 UTF-8 text bytes. All sources are below the 180,000-byte per-source ceiling; **no size truncation**. Site navigation, tables of contents, promotional/interface links, image references, and irrelevant footer content were excluded where present. Substantive policy text, disclosure tables, and Google's explanatory definitions were retained. Source-provided date lines were preserved; no effective dates were inferred.

## Retrieval Results

- **Google Privacy Policy and location information:** direct HTTPS 200 responses. Text mechanically extracted from the official HTML's `#main-content` article, including the final policy material.
- **Quizlet Privacy Policy:** normal public Codex in-app browser access succeeded on the first attempt, within the five-minute limit. The rendered policy, California disclosure table, jurisdictional rights, and final Contact Us section were inspected. No login, CAPTCHA solving, or private account extraction.
- **OpenAI US Privacy Policy:** direct retrieval returned HTTP 403 with a JavaScript/cookie challenge. Jina returned substantive text but omitted the disclosure table and contact section. The saved snapshot instead uses the fuller normal public-browser rendering, including all 13 numbered sections and the disclosure table. No login or CAPTCHA solving.
- **Data Controls FAQ:** HTTP 200 from the approved public `r.jina.ai` reader; its `URL Source` matched the exact official catalog URL. The full returned FAQ body was inspected through the final advertising-controls question. The relative source label `Updated: 23 days ago` remains relative.

No challenge response or search snippet was accepted as a snapshot. No paid scraping was used.

## Verification Boundary

Verification here means the agent read the acquired policy/FAQ content and checked its source identity, substantive sections, ending, schema, timestamps, and size. It does **not** establish that a service follows its policy, that any user's settings changed, or that tracking/data collection was prevented. No human review or legal audit is claimed.

For the reader capture, the official page is the stated upstream source, but retrieval is through a third party. Reader cache freshness and byte-for-byte equivalence to the live upstream page were not independently established. Browser captures are rendered public text, not raw HTTP-body attestations. HTML/Markdown formatting and link destinations are not preserved byte-for-byte.

## Reproducibility

Raw acquisition responses/rendered text, normalization code, and reviewed intermediate JSON are temporarily available in `/tmp/shiftsc-privacy.eIOc8o/`. The five final JSON files were mechanically copied from the normalized captures, not manually composed policy text.

Run `node /tmp/shiftsc-privacy.eIOc8o/verify.mjs --final` to check the saved files against the reviewed captures: exact catalog IDs/URLs, seven-field schema, raw-capture UTC timestamps, substantive section markers, rejection of challenge text, size limits, all 13 OpenAI policy sections, and byte-for-byte equality to staged JSON. This is source-artifact validation only; application retrieval code and application tests are outside this acquisition task.
