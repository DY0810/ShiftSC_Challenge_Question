# Privacy Choices MVP

An educational Chrome extension for reviewing Google Maps, Quizlet, and ChatGPT
privacy disclosures before visiting.

Built by DongYeop Lee for the ShiftSC Fall 2026 Cyber Privacy challenge.
Start with the [interviewer introduction and full setup guide](https://github.com/DY0810/ShiftSC_Challenge_Question#start-here-for-interviewers)
for the rationale, walkthrough, troubleshooting, and optional developer setup.

## Download and Run

1. Download `privacy-choices-extension.zip` below and extract it.
2. Open `chrome://extensions` in desktop Chrome and enable Developer mode.
3. Choose Load unpacked and select the extracted folder containing `manifest.json`.
4. Open Privacy Choices and configure the private demo token supplied separately
   by the owner. The token is not included in this public release.

No Node.js or personal OpenAI key is needed to run the hosted extension.
Request the private token from DongYeop through the interview/application
correspondence. Do not enter an OpenAI key or publish the token in a GitHub issue.
The backend URL is not a standalone web app; open the interface through Chrome's
extensions menu.

## Try the Workflow

Choose a supported service, select acceptable data types and optional uses, and
click **Analyze policy**. Expand **Details & policy evidence**, then choose
**Find reductions** and **Review remaining risks**. Finish with **Do not visit**
to inspect the decision flow without opening the company website.

Guided changes do not remove conflicts automatically. A Maps browser-location
block affects all `www.google.com` pages; restore the extension rule after a
control demonstration. It does not necessarily resolve any returned finding.

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
