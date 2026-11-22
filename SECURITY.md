# Security and privacy

This is a local, single-user tool. Do not expose the standard-library HTTP service or Chrome's CDP port to a network. Host and Origin checks protect browser requests; they are not authentication against other local processes.

Private data is stored only in the configured data/export directories. It is not encrypted by the app. Backups contain personal information. Source releases must use the allowlist package script and be inspected before publication.

The BOSS adapter accepts only search/detail, uses argv without a shell, bounds pages and timeouts, rejects non-loopback CDP URLs, and stops on risk responses. It never exposes arbitrary CLI execution or automatically logs in, sends messages, applies, uploads resumes, or clears platform locks.

When reporting a bug, use an anonymous fixture and remove names, contacts, employment details, cookies, tokens, URLs containing session identifiers, and local machine paths. Do not attach your data directory or browser profile.
