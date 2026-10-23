# Waitlist consent texts

Each sign-up stores the `consent_version` that was shown next to the form (`CONSENT_VERSION` in `functions/api/waitlist.js`). When the text changes, add a new version here and update the constant in the same commit. A test checks that the page shows exactly the text recorded for the current version.

## waitlist-2026-10-23

Shown under both forms on the home page, from 23 October 2026:

> Early access is free. No spam, pinky promise.
> We’ll only email you about Tape and your invite. You can withdraw at any time. Privacy

"Privacy" links to `/privacy`, the version of the privacy page in the same commit.
