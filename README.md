# Codex Agent

A small Windows companion for [Codex Hub](https://agent-board-stepan.readymars.chatgpt.site). It runs in the system tray and executes tasks using the **Codex app already installed on your computer**.

This repository also includes the complete website source in [`site/`](site/).

## Repository layout

| Directory | Purpose |
| --- | --- |
| [`site/`](site/) | Codex Hub website, server routes, database schema, migrations, and build configuration |
| [`runner/`](runner/) | Local task execution and Codex integration |
| [`windows/`](windows/) | Native tray app and Windows installer sources |

See the [website README](site/README.md) to run or build the web application.

## Install

1. Download [Codex-Agent-Setup-x64.exe](https://github.com/greeeenie/codex-agent/releases/latest/download/Codex-Agent-Setup-x64.exe).
2. Run the installer. It installs for your Windows account without requiring administrator access.
3. The agent starts automatically. Confirm the computer connection in the browser. Your existing Codex sign-in is reused when available.

**No separate Node.js installation, npm commands, or command prompt is required. Codex is not bundled or installed by this application.** Open the installed Codex app once so its local engine and project metadata are available.

Windows 10 version 2004 or newer, x64. The installer includes a private, checksum-verified Node.js runtime and a native Windows tray application. The current installer is unsigned.

## Use

The board has four columns: **Backlog → Queued → Running → Done**. New tasks stay in Backlog until you move them into Queued. The agent takes queued tasks one at a time. Failed, interrupted, or blocked tasks return to Backlog with a short explanation; they are not marked done or automatically retried.

Successful tasks include a short result and actual screenshots when available. Restoring a task returns it to Backlog with its existing Codex context; it does not revert project files. Queue polling and quota synchronization do not invoke the model.

Closing the agent window keeps it running in the tray. The tray menu provides status, restart, startup preference, and Quit. Optional startup is enabled by default in the installer. Uninstall through Windows Settings → Apps. Uninstallation stops the agent and removes its startup entry; existing project files and the encrypted connection are preserved.

## Existing Codex installation

On Windows, the agent first discovers the desktop engine under `%LOCALAPPDATA%/OpenAI/Codex/bin/`. It can also use an existing Codex CLI on PATH. A custom executable can be selected with `CODEX_BINARY`; the agent never downloads Codex when it cannot find an installation.

Local projects are read from Codex's project metadata in `.codex/.codex-global-state.json`. This internal format may change. For explicit configuration, create `%LOCALAPPDATA%/CodexAgent/runner.json` using `runner/projects.example.json`. Only local projects are supported.

## Privacy and permissions

The board remains private. Pairing uses a loopback callback with an Origin check and a random state value. Tokens never appear in command-line arguments, the download, or the public repository. Windows stores the board connection with DPAPI encryption for the current user in `%LOCALAPPDATA%/CodexAgent/connection.json`. The official Codex engine manages Codex authentication; the agent does not read `auth.json`.

Task execution uses the workspace-write sandbox. Additional permissions are not silently granted. If a task needs human input or approval, it stops in Backlog with an explanation. Only the agent's own child process tree is stopped when the tray application exits.

## Build from source

Build on Windows with Node.js 22+ and the .NET Framework compiler included in Windows. Install or extract the official [Inno Setup](https://jrsoftware.org/isdl.php) compiler and set `ISCC_PATH` to its `ISCC.exe`, or place the portable compiler in `.build/tools/inno/`.

```powershell
node --test runner/engine.test.mjs runner/find-codex.test.mjs
npm run build:windows
```

The build downloads the pinned Node.js runtime from nodejs.org and checks its SHA-256 against the official checksum manifest. Outputs are `dist/Codex-Agent-Setup-x64.exe` and `dist/SHA256SUMS.txt`. No credentials or Codex binaries are included.

For a read-only installed-runtime diagnostic without executing a model task:

```powershell
CodexAgent.exe --self-test=C:\Temp\codex-agent-diagnostics.json
```

Development without the installer remains available with `node runner/start.mjs`. This path uses your current Node.js installation. `%LOCALAPPDATA%/CodexAgent/agent.log` contains local operational errors; do not post logs containing personal project details publicly.

## Clarification questions

When a task needs input, its card shows a waiting indicator. Open the card, answer the question, and the agent continues in the same Codex conversation. Waiting only polls the board; it does not run the model. A pending question and its answer are saved so the agent can resume after a restart. Stop remains available while waiting.

Projects removed from Codex disappear from the board after the next project sync. Recreated project IDs for the same local directory are merged, preserving all task history. You can also remove a project from the picker and undo that removal. Removing a project from the board does not delete its local files.

Task conversations are attached to the matching Codex desktop project when created. Restored tasks and pending questions retain their project assignment. Projects are resolved from the desktop identity mapping and verified against their local directory; missing or ambiguous projects do not start model work.

Codex conversations use their board card titles. The initial prompt includes the task text once, followed by concise execution and reporting instructions.
