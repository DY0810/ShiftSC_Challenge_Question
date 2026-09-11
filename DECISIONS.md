# Decision Record

## User's goals (verbatim)
1. Do they want to still use the service after being acknowledged about the different information that they are giving away?
2. Do they know about the different types of information that they are giving away?
3. What types of information do they not want to give away?
4. How do they want their information to be handled and managed.
5. How the website is already handling their information

## Confirmed choices
- Preview before visiting; the target is opened only after an explicit click.
- Preset information choices with None and All.
- Highlight mismatches, find reductions, apply verifiable controls, then reassess.
- Keep the final decision with the student; acknowledge remaining risks to proceed.
- Three services: Google Maps, Quizlet, ChatGPT, browser versions only.
- Live policy analysis using OpenAI; private hosted demo.
- $5 total API allowance. Public reader and clearly dated fallback snapshots allowed.
- Two-page showcase PDF, produced after verification.

## Engineering rationale
- Compare data types separately from downstream purposes: a training opt-out does
  not stop a service receiving the user's text.
- Policy statements are not independent observation of actual collection.
- Block browser geolocation without claiming that IP-derived or typed locations
  disappear. Explain the Google-origin scope and provide restoration.
- Guided settings remain unverified. Do not silently delete those mismatches.
- No target-site contact from the student's browser during preview. The hosted
  backend and approved processors still receive necessary request metadata.
- Keep API keys server-side; restrict retrieval to fixed official source URLs.
- Use persistent, atomic spending reservations rather than in-memory serverless
  counters or provider billing alerts.
- A source challenge is missing evidence, not proof of good or bad privacy.
- Analyze consecutive small sections instead of asking one model response to
  interpret an entire long policy. Preserve every section and its source identity.
- Copy complete evidence ranges server-side, then use a separate model request
  to challenge each explanation against its own passage and immediate context.
  Do not call this independent or human verification.
- Keep completed section checks cached so a failure later in a policy does not
  force another paid analysis of earlier sections. Publish no incomplete review.
- Reserve budget for extraction and evidence checking separately while preserving
  the same persistent $5 total allowance, including earlier attempts.
- Preserve supported collection facts when purpose or retention is unknown.
  Remove unsupported details rather than inventing them; an unknown purpose
  remains unresolved in the preference comparison.

## Evidence policy
Record source capture dates, actual commands, and observed outcomes. Never invent
screenshots, user-testing results, latency, costs, personal experiences, or live
completion. Preserve the boundary between fixtures, source checks, browser checks,
hosted verification, and individual account settings.
