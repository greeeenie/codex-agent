# Codex Hub

A private Russian-language task board connected to a local Windows Codex agent. Structured records live in Sites D1; attachments and real result screenshots live in R2.

## Workflow

Cards follow **Backlog → Queued → Running → Review → Done**. Only the user's acceptance moves a result from Review to Done. Attempt states (running, waiting for input, error, stopped, completed) are stored separately. Failures, interruptions and lost connections never return cards to Backlog automatically.

The queue has one global, persisted execution order across projects. New enqueues append. Drag within a column or use First / Up / Down to reorder. The first visible queued task must have an available project and compatible connected agent; later tasks do not bypass it. The pause control prevents new claims while allowing the active attempt to continue. An atomic database claim limits execution to one task even with multiple agents or tabs. Agents without the `workflow-v2` capability cannot claim tasks.

Cards open in a modal above the board. Titles and descriptions can be edited independently; active attempts retain the original input snapshot. Send clarifications separately to the active Codex turn. Draft text, model choices and attachment references are stored on the current device; selected files use IndexedDB. Project selection, search, attention filter, archive view and the open card are remembered locally. Browser storage failures are displayed.

## Human input and recovery

The local agent runs task commands with full filesystem and network access and command approvals disabled. Codex clarification questions and connector-specific consent remain pending until the user answers. The board retains request IDs, methods, prompts and form/options data; the agent responds to the original live request. Structured final questions remain waiting instead of becoming successful results. Successful work goes to Review.

Attempts and transition/activity/question/answer events are retained. Reports compare the attempt ID at the write and are safe to retry after a lost HTTP response. Late reports and screenshots cannot change a newer attempt. The local execution journal contains attempt/context IDs and pending deliveries, never the Site token. Recovery reads the previous Codex turn before reporting its observed outcome and does not automatically start a new turn. A lost live request offers continuation with saved context. An offline stop holds the execution slot until the agent confirms the interruption; changing connection status alone never moves a card.

Archive and restore preserve history and project files. Duplicate copies the task input and its attachments into a new Backlog card. Existing project chats can be imported from the agent's cached `thread/list` results or linked by ID. Import does not execute work and repeated imports converge on the same card. Before resuming, the agent checks that the chat belongs to the selected project directory. If the installed Codex cannot list chats, ID linking remains available. The cached picker currently shows up to 50 recent chats per project; ID linking handles older chats.

Title generation checks that `gpt-6-luna` with `low` effort is actually available through `model/list`, then uses an isolated read-only turn. If unavailable or unsuccessful, the first description line becomes an editable fallback title. No API key is copied from Codex.

## Development and delivery

```powershell
npm run dev -- --port 5173
npx tsc --noEmit
node --test lib/*.test.mjs runner/*.test.mjs
```

Schema changes are append-only Drizzle migrations in `drizzle/`. Local previews and hosted databases are separate. Publish through the Sites skill to apply hosted migrations and preserve the existing site's audience. Existing Sites projects executed by the agent follow the same delivery workflow unless their task explicitly requests local-only changes.

The canonical website checkout and the public [Windows agent repository](https://github.com/greeeenie/codex-agent) are separate. Sync website source into the distribution repository's `site/` directory without credentials, runtime data or private Site identity. Runtime changes require tests, a rebuilt installer, an English GitHub release and an installed-agent update. Updating source alone does not replace a running agent.

## Limits

Local projects execute while their computer and agent are running. Permissions cannot be forwarded into an app-server process that has already exited; continuation creates a new attempt using saved context. Attempt records start with this release; previous activity cannot be reconstructed retroactively. File changes remain in the project after stop, retry or archive. The private Site audience is required by the current service authentication design.
