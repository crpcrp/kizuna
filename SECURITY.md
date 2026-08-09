# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Use GitHub's private vulnerability reporting:

<https://github.com/crpcrp/kizuna/security/advisories/new>

If private reporting is unavailable, open an issue without technical details and
ask the maintainer to establish a private channel.

Include the affected version or commit, impact, operating system tested, and a
minimal reproduction. Do not include credentials, personal data, copyrighted
media, or private dictionary files.

## Scope

Security issues in Kizuna's Electron processes, IPC, local data handling,
parsers, network features, packaging, or CI are in scope. Vulnerabilities in
mpv, FFmpeg, MeCab, Electron, Chromium, or external services should
normally be reported upstream unless Kizuna uses the component unsafely.

Kizuna does not attempt to protect data from an attacker who already controls
the user's operating-system account. Scanner output without a demonstrated
impact may not be actionable.

## Supported versions

Kizuna is pre-release. Only the current `main` branch is supported; fixes are
not backported.

## Response

This is a single-maintainer project. Reports are handled on a best-effort basis
according to severity and maintainer availability. Confirmed issues may be fixed
on `main` and disclosed through a GitHub advisory. Reporters are credited
unless they request otherwise.
