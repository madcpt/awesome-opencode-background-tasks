import type { BackgroundTask } from "./types.js"

export function formatTasks(tasks: BackgroundTask[]) {
  if (tasks.length === 0) return "No background tasks."
  const rows = tasks.map((task) => {
    const elapsed = formatDuration((task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt))
    const label = task.label ? ` ${task.label}` : ""
    return `${task.id}  ${task.status.padEnd(9)}  ${elapsed.padStart(7)}${label}\n  ${task.command}\n  cwd: ${task.cwd}`
  })
  return rows.join("\n\n")
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
