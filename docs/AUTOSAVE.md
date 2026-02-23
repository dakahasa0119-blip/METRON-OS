# Autosave / Crash Recovery

## What is enabled now

- Local Git repository initialized at workspace root.
- Autosave daemon commits all file changes every 5 minutes.
- Chat memory helper to append important conversation notes.

## Commands

- Start daemon:
  - `scripts/autosave_daemon.sh start`
- Stop daemon:
  - `scripts/autosave_daemon.sh stop`
- Status:
  - `scripts/autosave_daemon.sh status`
- Save immediately:
  - `scripts/autosave_daemon.sh once`

## Chat memory notes

Add a note you want to preserve:

- `scripts/add_chat_note.sh "short summary here"`

Notes are stored in:

- `docs/CHAT_MEMORY.md`

## Recovery after crash

1. Check latest commits:
   - `git log --oneline -n 20`
2. Inspect what changed in a commit:
   - `git show <commit_id>`
3. Resume daemon if needed:
   - `scripts/autosave_daemon.sh start`
