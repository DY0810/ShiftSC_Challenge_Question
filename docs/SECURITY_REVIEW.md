# Prepublication Security Review

Review date: September 11, 2026. Runtime: Node.js 22.22.1.

## Scope and Result

The whole-repository audit, independent security review, initial-commit diff
audit, and security checklist found one confirmed low-severity issue in the
local development server. A client connected to its loopback listener could
terminate the process with a malformed URL or interrupted request body.
This was not a demonstrated vulnerability in the hosted Vercel endpoint.

The fix places URL parsing, body consumption, and API dispatch inside the
request error boundary. Invalid URLs receive a generic 400 response. Disconnected
or completed responses are not written again; an unfinished response with
committed headers is closed. Authentication, static-file containment, routing,
and the 512-byte body limit remain unchanged.

The new regression test failed before the fix on two malformed URL forms and
an interrupted upload. After the fix, those inputs and invalid chunk framing
leave the server available for a subsequent valid request.

The pre-patch independent investigator confirmed the boundary and compatibility
constraints. The final automated patch-review worker was blocked by its security
gateway and produced no review; it is not counted as a passed independent check.
The main review's direct regression verification passed. Publication checks found
no configured secrets or common credential patterns in staged files, reachable
Git blobs, or extracted PDF text, and no forbidden local-only files were staged.

## Repeatable Checks

```sh
node --check scripts/dev.mjs
node --check test/dev.test.mjs
node --test test/dev.test.mjs
npm run test:browser
API_BASE=https://shiftsc-privacy-choices.vercel.app npm run package
npm run check
npm audit --json
```

- All 36 automated tests passed, with no skips on the review machine.
- Four local-server tests cover malformed targets, interrupted/chunked bodies,
  static paths, HEAD, API routing/authentication, and size/error responses.
- The real Redis check accepted 71 of 100 concurrent reservations, totaling
  $4.97 under the $5 allowance.
- Real Chromium extension verification passed, including the native location
  setting, consent boundaries, restoration, narrow layouts, and keyboard focus.
  Policy responses in that test are explicitly synthetic fixtures.
- The 24-file extension package passed syntax, permission/origin restrictions,
  credential-pattern checks, and ZIP integrity.
- The lockfile audit reported zero known dependency advisories at review time.

Redis must be installed to repeat its integration check; otherwise that test
reports a skip. Browser verification requires Playwright's Chromium installation.
These commands run locally; no hosted CI result is implied.

## Boundaries

The initial directory audit had a coverage caveat because Git was initialized
after its snapshot. The separate frozen initial-commit diff accounted for all
63 initial files, with explicit binary and dependency-content exclusions.
The remediation review is focused on the changed request boundary.

Live model analysis remains disabled until OpenAI and persistent Upstash
credentials are configured. No paid model call, production Redis persistence
or eviction policy, actual third-party collection behavior, or model semantic
accuracy is established by these checks.

Generated output, local workflow notes, environment files, and deployment
metadata are excluded from source control. The deliberately published PDF
contains fixture labels and no access credentials.

No finite review guarantees an absence of vulnerabilities. Recheck dependencies
and deployment configuration before enabling a later public demo.
