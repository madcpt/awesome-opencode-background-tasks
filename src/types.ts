export type TaskStatus = "queued" | "running" | "stopping" | "completed" | "failed" | "killed"

export interface BackgroundTask {
  id: string
  project: string
  sessionID: string
  label?: string
  command: string
  cwd: string
  status: TaskStatus
  pid?: number
  exitCode?: number
  signal?: string
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  notifiedAt?: number
}

export const terminalStatuses = new Set<TaskStatus>(["completed", "failed", "killed"])
