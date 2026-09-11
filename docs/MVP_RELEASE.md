# Privacy Choices MVP

An educational Chrome extension for reviewing Google Maps, Quizlet, and ChatGPT
privacy disclosures before visiting.

## Download and Run

1. Download `privacy-choices-extension.zip` below and extract it.
2. Open `chrome://extensions` in desktop Chrome and enable Developer mode.
3. Choose Load unpacked and select the extracted folder containing `manifest.json`.
4. Open Privacy Choices and configure the private demo token supplied separately
   by the owner. The token is not included in this public release.

No Node.js or personal OpenAI key is needed to run the hosted extension.

## Showcase

The attached two-page PDF explains the problem, design decisions, implementation,
and evidence boundaries. The repository contains the source and reproducible
checks.

## Verified Scope

- 57 local tests and the 24-file package check passed.
- The installed extension completed hosted analysis and decision workflows for
  all three services, with no company visit during that check.
- Sources may be live, retrieved through a public reader, or dated snapshots.
  Findings are selective AI interpretations and may be wrong or incomplete.
- Maps' browser-location control does not hide IP location or erase prior data.
  Guided account changes remain unverified.

## Demo Limits

The original $5 application allowance includes development and failed attempts.
Only a small balance remains for new model calls; unchanged cached analyses
avoid new model charges. Changes to policy content may need new calls and can
exhaust the allowance. The owner has not reset or raised the cap.

The current provider key expires October 11, 2026. This is a time-limited private
demo, not a permanently free public analysis service.
