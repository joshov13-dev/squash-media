# Security policy

SquashMedia is a free, community-maintained project (see the [Legal section of the README](README.md#legal) for the full disclaimer). There's no dedicated security team and no guaranteed response time, but genuine security reports are taken seriously and fixed as quickly as possible.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security problem. Instead, use GitHub's private reporting:

1. Go to the [Security tab](https://github.com/joshov13-dev/squash-media/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and its impact.

If that isn't available, open an issue asking to be contacted privately, without details of the vulnerability itself, and a way to reach you will be arranged.

## What's in scope

SquashMedia runs entirely on your own computer with no server component (see [Privacy & data](README.md#privacy--data)), so most of what would be a "vulnerability" in a web app doesn't apply here. Reports that are genuinely useful include:

- A crafted photo, video, or folder name that can run code, corrupt files outside the intended output, or crash the app in a way that loses data.
- A way the auto-updater could install something other than a genuine SquashMedia release.
- Anything that would let data leave your computer without your say-so, contradicting the privacy claims in the README.

## What's out of scope

- Vulnerabilities in FFmpeg, sharp/libvips, Electron/Chromium, or any other bundled third-party component — please report those upstream (see [Third-party notices](THIRD-PARTY-NOTICES.md) for where each project lives). If a fix requires bumping a bundled version, a report here noting that is still welcome.
- Issues that require an attacker to already have arbitrary code execution on your machine.

## No bounty

This is an unpaid, volunteer project — there is no bug bounty on offer, only a thank-you and credit if you'd like one.
