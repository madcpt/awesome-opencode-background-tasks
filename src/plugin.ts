import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { formatTasks } from "./format.js"
import { TaskManager } from "./manager.js"
import { taskProjectPath } from "./paths.js"
import { backgroundTaskPolicy } from "./policy.js"
import { filterByStatus, TaskStore } from "./store.js"
import type { BackgroundTask } from "./types.js"
import { terminalStatuses } from "./types.js"

export const BackgroundTasksPlugin = (async ({ client, directory, worktree }) => {
  const store = new TaskStore(taskProjectPath({ directory, worktree }))
  await store.initialize()
  const watched = new Set<string>()

  const notify = async (task: BackgroundTask) => {
    if (task.notifiedAt) return
    const success = task.status === "completed"
    await client.tui
      .showToast({
        body: {
          title: "Background task",
          message: `${task.label ?? task.id} ${success ? "completed" : task.status}`,
          variant: success ? "success" : task.status === "killed" ? "warning" : "error",
          duration: 6000,
        },
      })
      .catch(() => undefined)
    task.notifiedAt = Date.now()
    await store.save(task)
  }

  const manager = new TaskManager(store, notify)
  for (const task of await store.list()) {
    const refreshed = await store.refresh(task)
    if (!terminalStatuses.has(refreshed.status)) watched.add(refreshed.id)
  }

  const poll = setInterval(() => {
    void (async () => {
      for (const task of await store.list()) {
        const refreshed = await store.refresh(task)
        if (!terminalStatuses.has(refreshed.status)) watched.add(refreshed.id)
        if (terminalStatuses.has(refreshed.status) && watched.delete(refreshed.id)) await notify(refreshed)
      }
    })()
  }, 2000)
  poll.unref()

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(backgroundTaskPolicy)
    },
    "tool.definition": async ({ toolID }, output) => {
      if (toolID !== "bash") return
      output.description +=
        "\n\nFor commands likely to take more than a few seconds, prefer the background_bash tool so the Agent can continue working. Use bash for quick or interactive commands."
    },
    tool: {
      background_bash: tool({
        description:
          "Start a long-running shell command as a detached background task. Returns immediately with a task ID; use background_tasks and background_output to monitor it.",
        args: {
          command: tool.schema.string().describe("Shell command to run"),
          workdir: tool.schema.string().optional().describe("Working directory, relative to the session directory by default"),
          label: tool.schema.string().optional().describe("Short human-readable task label"),
        },
        async execute(args, context) {
          const cwd = path.resolve(context.directory, args.workdir ?? ".")
          await context.ask({
            permission: "background_bash",
            patterns: [args.command],
            always: [args.command],
            metadata: { command: args.command, cwd },
          })
          const task = await manager.start({ sessionID: context.sessionID, command: args.command, cwd, label: args.label })
          watched.add(task.id)
          return {
            title: `Background task ${task.id}`,
            output: `Running in the background (↓ to manage)\nTask: ${task.id}\nPID: ${task.pid}\nLog: ${store.logPath(task.id)}`,
            metadata: { taskID: task.id, pid: task.pid, status: task.status },
          }
        },
      }),
      background_tasks: tool({
        description: "List background shell tasks and their current status.",
        args: {
          status: tool.schema.enum(["all", "running", "finished"]).default("all").describe("Task status filter"),
        },
        async execute(args) {
          const tasks = await Promise.all((await store.list()).map((task) => store.refresh(task)))
          return formatTasks(filterByStatus(tasks, args.status))
        },
      }),
      background_output: tool({
        description: "Read the latest combined stdout and stderr from a background task.",
        args: {
          task_id: tool.schema.string().describe("Background task ID"),
          lines: tool.schema.number().int().min(1).max(2000).default(200).describe("Number of trailing lines"),
        },
        async execute(args) {
          const task = await store.get(args.task_id)
          if (!task) throw new Error(`Unknown background task: ${args.task_id}`)
          const refreshed = await store.refresh(task)
          const output = await store.tail(task.id, args.lines)
          return `Task ${task.id}: ${refreshed.status}${refreshed.exitCode === undefined ? "" : ` (exit ${refreshed.exitCode})`}\n\n${output || "(no output)"}`
        },
      }),
      background_kill: tool({
        description: "Stop a running background task and its process group.",
        args: {
          task_id: tool.schema.string().describe("Background task ID"),
          force: tool.schema.boolean().default(false).describe("Use SIGKILL instead of SIGTERM"),
        },
        async execute(args, context) {
          await context.ask({
            permission: "background_kill",
            patterns: [args.task_id],
            always: [args.task_id],
            metadata: { taskID: args.task_id, force: args.force },
          })
          const task = await manager.kill(args.task_id, args.force)
          return `Task ${task.id}: ${task.status}`
        },
      }),
    },
    dispose: async () => clearInterval(poll),
  }
}) satisfies Plugin

export default BackgroundTasksPlugin
