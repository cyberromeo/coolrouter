# Security

Please report vulnerabilities privately by opening a GitHub security advisory on
https://github.com/cyberromeo/coolrouter/security/advisories rather than a public issue.

Running Cool Router safely:

- Change the dashboard password on first launch (Settings → Security).
- Keep `.env` private; it holds your encryption secrets.
- Require API keys (`REQUIRE_API_KEY=true`) when the server is reachable from other machines.
