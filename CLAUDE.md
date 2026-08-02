# CLAUDE.md

Compatibility entry point for tools that discover `CLAUDE.md`. The repository
rules live in [AGENTS.md](AGENTS.md); read it first and keep this file short so
the two entry points cannot drift.

Key reminders:

- WonderfulUI is a Windows x64 personal highlight library, not an ACLOS parser
  product or cloud service.
- Keep ACLOS/WonderfulDb and game-related files read-only; never hard-code a
  user's paths, openid, or media data.
- Do not describe the app as completely offline: production checks GitHub
  Releases, and user-triggered 快传 opens a temporary LAN HTTP service.
- Documentation tasks must not change runtime behavior, dependencies, IPC,
  build configuration, workflows, CSS, or database logic.
- Use the owner documents linked from `AGENTS.md`; do not recreate their detail
  in this compatibility file.
