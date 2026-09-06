# Decision: automatic local agent activity setup

Status: accepted for implementation, 2026-09-05.

The user requested ordinary CLI launches with automatic one-time setup. JaneT reuses its supported shell initialization and capability-bound activity bridge. A separately bundled Node helper performs additive Codex/Hermes configuration setup before the original executable runs. The renderer has no installation IPC and cannot supply arbitrary configuration paths.

Existing configuration and required hook trust remain authoritative. TOML is parsed only to inspect settings, never globally reserialized. Hermes YAML is edited as a document to preserve unrelated nodes. Updates are bounded, backed up, locked against concurrent JaneT installers, checked for external edits and atomically renamed. Filesystem replacement has no cross-platform compare-and-swap operation; a third-party writer racing the final rename remains a limitation. There is no transcript scraping or automatic approval.

Helpers use a stable app-data path, not a new path every terminal. Events are reduced to validated lifecycle identifiers before crossing the loopback boundary. Terminal closure revokes the capability; session/turn ownership prevents child or stale completions from changing another turn. OS and agent consent continue to apply.

Alternatives not selected: launching a different agent interface/app-server (changes interactive UX); replacing an agent home (redirects auth/history); discarding existing notification handlers; relying on output inactivity; implementing undocumented hooks for every CLI. Unsupported sources stay explicit in terminal-activity.md.

Completion correction, 2026-09-05: leaving an existing Codex notify command entirely untouched installed only half the lifecycle and left idle sessions marked Running. The approved correction connects a forwarding callback at root and profile levels. It preserves the original argv and payload, invokes it without a shell even outside JaneT, and sends only reduced lifecycle data to JaneT independently of downstream notifier failures. Only notify array spans are changed; full-document reparsing verifies every unrelated value remains unchanged. Setup failures and explicit CLI notify overrides report incomplete tracking. The helper no longer requires stdin EOF before accepting its one complete JSON event.
