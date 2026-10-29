export type Status = 'backlog' | 'queued' | 'running' | 'done';
export type Project = {id: string; name: string; path: string; host: string};
export type Shot = {key: string; caption: string};
export type Task = {id: string; projectId: string; title: string; description: string; status: Status; result: string; createdAt: number; startedAt: number | null; finishedAt: number | null; threadId: string | null; turnId: string | null; runId: string | null; screenshots: Shot[]; stopRequested: number};
export type RateWindow = {usedPercent: number; windowDurationMins: number; resetsAt: number};
export type Agent = {seenAt: number; account: {type: string; email?: string; planType?: string} | null; rateLimits?: {primary?: RateWindow; secondary?: RateWindow}; authUrl?: string; error?: string};
export type Snapshot = {projects: Project[]; tasks: Task[]; agent: Agent | null; paused: boolean};
