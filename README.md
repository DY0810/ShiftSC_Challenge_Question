# Privacy Choices

**A privacy decision aid for students, built for the ShiftSC Fall 2026 Cyber Privacy challenge.**

By DongYeop Lee.

Privacy Choices is a desktop Chrome extension that helps a student answer:
**"Does this service's use of my information match what I am comfortable sharing?"**
It explains public privacy disclosures, compares them with the student's preferences,
and offers limited controls before the student decides whether to visit.

The MVP supports **Google Maps, Quizlet, and ChatGPT's desktop websites**.
It is an educational prototype, not a tracker scanner, security rating, or anonymity tool.

## Start Here: For Interviewers

| What you want to do | Where to start |
| --- | --- |
| Understand the project without installing anything | [Two-page showcase PDF](docs/Privacy_Choices_ShiftSC_Showcase.pdf) |
| Try the extension | [Download the Chrome extension ZIP](https://github.com/DY0810/ShiftSC_Challenge_Question/releases/download/v1.0.0-mvp/privacy-choices-extension.zip), then follow the steps below |
| Find both deliverables | [MVP release](https://github.com/DY0810/ShiftSC_Challenge_Question/releases/tag/v1.0.0-mvp) |
| Read the design rationale | [Decision record](DECISIONS.md) |
| Inspect the security-review scope | [Security review](docs/SECURITY_REVIEW.md) |

**Before trying the hosted demo, obtain the private demo token from DongYeop through
the interview/application correspondence.** It is deliberately excluded from GitHub.
Do not enter an OpenAI API key in the extension or post credentials in an issue.

You need desktop Chrome, internet access, permission to load an unpacked extension,
and the demo token. **You do not need Node.js, a terminal, your own OpenAI account,
payment, or a local server** to use the downloaded extension.

**Availability:** this is a time-limited private demo. The original $5 application
allowance includes development and failed requests and is nearly exhausted.
Unchanged cached results avoid new model charges; changed or expired sources may
require calls that the remaining allowance cannot cover. The current provider key
expires **October 11, 2026** unless the owner rotates it. If access is unavailable,
the PDF and source remain reviewable without credentials.

## Why I Built It

Privacy policies describe collection and data use, but interpreting them is work
the student usually has to do alone. A universal "safe" score also ignores that
different students have different boundaries.

This project connects five questions:

1. What information does the service say it collects?
2. Which information am I comfortable sharing?
3. For which purposes can that information be used?
4. What can I change, and what remains uncertain?
5. Knowing the remaining risks, do I still want to use it?

The central distinction is that **agreeing to share information is not the same
as agreeing to every downstream use**. Submitting text to a service and allowing
that text to train models are separate choices.

## Install the Hosted Demo

1. Download **`privacy-choices-extension.zip`** from the [release](https://github.com/DY0810/ShiftSC_Challenge_Question/releases/tag/v1.0.0-mvp).
   Do not choose GitHub's automatically generated "Source code" ZIP for this path.
2. Extract it into a folder you can keep on your computer.
3. Enter **`chrome://extensions`** in desktop Chrome's address bar.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
   Select the folder, not the ZIP.
6. Open Chrome's extensions menu and click **Privacy Choices**. Pinning it is optional.
7. Click **Configure access token**, or open the settings icon. Enter the private
   demo token, click **Save token**, then **Close**.

This is an unpacked MVP, not a Chrome Web Store listing. If your organization
disables Developer mode or extension installation, use the PDF/source walkthrough;
do not bypass its device-management policy.

The interface opens from the extension toolbar. The Vercel URL is a backend API,
**not a standalone web application** that interviewers should open directly.

## Suggested Demo Walkthrough

### 1. Choose a Service and Set Your Boundaries

Select ChatGPT, Quizlet, or Google Maps, or enter a supported service URL.
Arbitrary websites and native apps are outside the MVP's scope.

Under **Your preferences**, use **None**, **All**, or individual checkboxes for
identity, browser location, approximate location, device identifiers, activity,
content, media, and payment information. Expand **Optional uses I accept** to
choose analytics, advertising, AI training, or third-party sharing.

These selections express preferences. They do not grant browser permissions or
change an account's settings.

### 2. Analyze and Inspect the Evidence

Click **Analyze policy**. A new analysis can take over a minute; cached results
still require source retrieval. You can cancel, and the extension stops waiting
after 210 seconds.

Review **Policy findings**, then expand **Details & policy evidence**:

- Which data type and use conflict with the selected preferences?
- What passage supports the explanation?
- Are conditions and retention stated, or unknown?
- Does **Sources & retrieval** identify direct retrieval, a public reader, or a dated snapshot?

Change a preference and observe the comparison update locally. A useful ChatGPT
example, when returned by the current analysis, is allowing submitted content while
leaving model training unaccepted. Finding counts are not fixed; absence of a
finding is not proof of no collection.

### 3. Find Reductions Without Overclaiming Protection

Click **Find reductions**.

| Service | What the MVP offers | What it does not claim |
| --- | --- | --- |
| Google Maps | An optional Chrome browser-location block, effective-setting readback, and restoration | It does not hide IP location, typed places, previously collected data, or every location source |
| Quizlet | A guide to ads and cookie settings | It does not automatically change or verify your account |
| ChatGPT | Guides to model-training choices and Temporary Chat | It does not prevent submitted content reaching the service or verify your account configuration |

For a Maps control demonstration, review the confirmation and grant the optional
permission only if you agree. The rule covers **all `https://www.google.com/*`
pages**, not just Maps, and persists until removed. Use **Restore extension rule**
afterward. Restoration removes this extension's override; it does not force
Chrome to allow location.

A successful browser block does not necessarily reduce the current mismatch count.
Only an explicitly supported browser-permission geolocation finding can be resolved
by that control. Disallowed downstream uses remain unresolved.

For guided settings, checking **I made a change in the service settings** records
your report but does not remove related conflicts. Unknown purposes also stay
unresolved, even when all listed uses are selected.

Opening a policy or guide contacts that company and can send normal browser
metadata and cookies. Those links require confirmation.

### 4. Make the Final Decision

Click **Review remaining risks**. The visit button stays disabled until you
acknowledge the remaining risks. You can then confirm a visit or choose **Do not visit**.

For an interview walkthrough, **Do not visit** demonstrates the decision flow
without opening the company site. It keeps you in the extension; it does not close
other tabs or erase information collected before the review.

## How It Works

```text
Service name / URL + preferences
              |
              v
Chrome extension: recognize a supported service locally
              |
              | serviceId + private demo token only
              v
Vercel backend: authenticate and retrieve official source text
              |
              v
Small policy sections -> AI extraction -> separate AI evidence check
              |
              | source-linked findings, unknowns, and retrieval metadata
              v
Chrome extension: compare locally -> offer controls -> student decides
```

The backend tries fixed official HTTPS sources, then a public reader, then dated
saved source text. Failed or challenged pages are not treated as privacy evidence.
Source methods, dates, and hashes accompany the result.

Available text is split into consecutive sections of at most 8,000 UTF-8 bytes.
No section is silently truncated; excessive input fails explicitly. Each section
can propose up to three findings. The server copies consecutive source sentences
as evidence. A separate AI request checks explanations, categories, and browser
applicability against that passage and its immediate context.

Invalid or unsupported candidates are excluded and counted. Unsupported purposes,
conditions, or retention details become unknowns when the collection fact itself
remains supported. Failed or refused sections stop the overall analysis without
publishing an incomplete set of section results.

Three sections run at a time. Completed section checks and complete results are
cached by content/version for seven days. A later user-initiated request can reuse
finished sections after a timeout. The persistent spending ledger reserves $0.02
before each extraction or review call, including failed calls, against the original
$5 cap. Earlier reservations remain counted; deployment does not reset the allowance.

**The second AI call is a consistency check, not independent verification.**
Exact quotations establish that text exists in the source. Neither that nor an
AI approval guarantees the interpretation is correct or that a company follows
its policy. Findings are selective, not an exhaustive inventory.

## Connection to Cyber Privacy

- **Informed consent:** understandable disclosures before the decision to visit.
- **Data minimization:** identify unwanted sharing and offer limited, supported reductions.
- **Purpose awareness:** separate collection from advertising, analytics, training, and sharing.
- **Transparency:** show evidence, source dates, unknowns, and failed checks.
- **User control:** keep the decision with the student rather than assigning a
  universal safety score or autonomously changing account settings.

The extension applies privacy principles to its own design:

| Data or capability | Handling |
| --- | --- |
| Entered URL and preference selections | Processed locally; not included in analysis requests |
| Service ID and demo token | Sent to the configured backend for the requested analysis |
| Preferences and demo token | Stored in the local Chrome profile, not an encrypted secret vault |
| Public policy text | Retrieved by the backend and processed by OpenAI; a public reader may be used |
| Browsing history and page contents | No history monitoring or content scripts |
| Browser-location control | Optional permission requested through an explicit user action |
| Provider credentials | Kept on the backend, never bundled in the extension |

Hosting and API providers may still receive IP addresses or maintain infrastructure
logs. `store: false` in the OpenAI request is not a promise of zero provider retention.
The extension is not a VPN, cookie-banner blocker, traffic inspector, or privacy audit.

## What Was Verified

Recorded for the **September 11, 2026 MVP release**, not continuous availability:

- **57 local tests** passed, covering evidence validation, unknown purposes,
  cancellation, section caching, and spending checks.
- A real Redis concurrency test confirmed small-call reservations stop at $5
  and preserve reservations made by the earlier implementation.
- The **24-file package** passed syntax, permission/origin checks,
  credential-pattern checks, and ZIP integrity.
- Chromium tests exercised location set/readback/restoration, consent, responsive
  layouts, keyboard focus, and reduced motion with labeled synthetic responses.
- A separate installed-extension check completed **actual hosted analysis and
  decision workflows for all three services**, with service IDs as the only
  request-body field and no company visit.

These checks do not prove complete finding coverage, semantic accuracy, real
tracking prevention, or individual account settings. No student usability study
has been completed. The [security review](docs/SECURITY_REVIEW.md) distinguishes
the initial audit from the later pipeline update.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Missing `manifest.json` | Extract the extension ZIP and select the folder directly containing that file |
| Developer mode unavailable | Use an authorized personal browser or review the PDF; do not bypass administrator restrictions |
| Token missing or rejected | Request the demo token from DongYeop; do not use an OpenAI key or newly generated local token |
| Unsupported service | Choose Maps, Quizlet, or ChatGPT |
| Slow response | Wait or cancel; a cold review can take over a minute |
| Rate limit | Wait a minute before requesting again |
| Budget exhausted / provider unavailable | Contact the owner and use the PDF/source meanwhile; reviewers should not need to purchase credits |
| Failed, filtered, or no supported findings | Treat this as missing evidence, not a favorable privacy result; avoid repeated paid retries |
| Conflicts remain after a setting change | Guided changes are unverified, unknown purposes stay unresolved, and browser controls resolve only narrowly supported claims |

## Developer Setup: Optional

This section is **not required for interviewers using the release ZIP**.
Commands below use a macOS/Linux shell. Development requires Node.js 22 and npm;
packaging also uses the `zip` executable.

### Build Against the Existing Hosted Backend

```sh
git clone https://github.com/DY0810/ShiftSC_Challenge_Question.git
cd ShiftSC_Challenge_Question
npm ci
API_BASE=https://shiftsc-privacy-choices.vercel.app npm run package
```

Load `dist/extension` in Chrome and use the owner's private demo token.
This does not create a separate spending allowance.

### Run Your Own Backend Locally

From the cloned repository:

```sh
npm ci
node scripts/setup-local.mjs
```

The setup script creates private `.env.local` with a random local access token.
Configure the following values in that ignored file:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Your funded OpenAI API project's credential with Responses API access |
| `UPSTASH_REDIS_REST_URL` | HTTPS REST endpoint for your persistent Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | Database credential allowing the required reads, writes, and Lua operations |
| `DEMO_ACCESS_TOKEN` | Private bearer token accepted by your backend; generated by the setup script |
| `PORT` | Local listener port; defaults to `4317` |

Use a dedicated Redis database with eviction disabled. Do not delete or reset
`shiftsc:privacy:budget:v1`, or replace its database, to bypass the allowance.
Provider billing and hosting/storage charges are separate from the application cap.

```sh
npm run dev
```

Load the repository's `extension/` folder in Chrome and enter your **local**
`DEMO_ACCESS_TOKEN`. Its backend is `http://127.0.0.1:4317`.
The ordinary browser page at that address is an interface preview only; it cannot
provide Chrome extension storage and browser controls.

If that port is occupied, choose a free port, start with `PORT=<port> npm run dev`,
and build a matching package with
`API_BASE=http://127.0.0.1:<port> npm run package`. Load that `dist/extension`
folder instead. The extension and backend must use the same port.

### Deploy Your Own Hosted Backend

Link the repository to your own Vercel project and configure the four credential
variables above as Production environment variables. `PORT` is local-only.
Use your own provider credentials and Redis instance, then run:

```sh
npx vercel deploy --prod
API_BASE=https://YOUR-PROJECT.vercel.app npm run package
```

Replace the example origin with your actual deployment origin. Load the generated
extension and enter that deployment's token. Never commit `.env.local`, include
credentials in screenshots, or put provider keys in extension files.

### Run Checks

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run package
npm run check
npm audit
```

The Redis integration test requires `redis-server` and `redis-cli`; it reports a
skip if unavailable. Browser tests use isolated profiles and labeled synthetic
responses. The explicitly confirmed Maps visit may contact Google; subsequent
observed subresources are intercepted.

To check the actual owner-hosted demo after building its hosted package:

```sh
API_BASE=https://shiftsc-privacy-choices.vercel.app npm run package
node --env-file=.env.local scripts/verify-hosted.mjs
node --env-file=.env.local scripts/hosted-extension-check.mjs
```

**Live checks can consume the remaining allowance.** Use the owner's token in
`.env.local` for the owner-hosted demo. `SERVICE_IDS=quizlet,chatgpt` limits a focused
check without claiming Maps was tested. The installed-extension checker currently
targets the original hosted demo; do not use it unchanged to assert that a
different deployment was verified.

## Repository Guide

| Path | Responsibility |
| --- | --- |
| [`extension/`](extension/) | Interface, local preferences, service recognition, browser controls |
| [`extension/catalog.js`](extension/catalog.js) | Supported services, categories, official sources, trusted action URLs |
| [`extension/core.js`](extension/core.js) | Service matching and preference/mismatch classification |
| [`api/analyze.mjs`](api/analyze.mjs) | Request validation and origin handling |
| [`lib/sources.mjs`](lib/sources.mjs) | Bounded retrieval and dated fallback handling |
| [`lib/analysis.mjs`](lib/analysis.mjs) | Section extraction, evidence ranges, and review validation |
| [`lib/service.mjs`](lib/service.mjs) | Authentication, model orchestration, caching, and failures |
| [`lib/ledger.mjs`](lib/ledger.mjs) | Atomic spending reservations and rate limiting |
| [`data/SOURCE_STATUS.md`](data/SOURCE_STATUS.md) | Source acquisition details and verification limits |
| [`test/`](test/) | Local regression and integration checks |
| [`scripts/`](scripts/) | Packaging, browser checks, hosted checks, and PDF generation |
| [`docs/`](docs/) | Showcase, release guide, and security-review notes |

The native HTML/CSS/JavaScript interface bundles fonts and icons locally.
There is no remote font request, browsing-history permission, or autonomous
account-editing agent. Local QA outputs and private workflow notes are not
distributed in the repository.
