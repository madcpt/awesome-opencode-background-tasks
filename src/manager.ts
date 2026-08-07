import { open, stat } from "node:fs/promises"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import type { BackgroundTask } from "./types.js"
import { TaskStore } from "./store.js"

type CompletionHandler = (task: BackgroundTask) => Promise<void>

export class TaskManager {
  private readonly children = new Map<string, ChildProcess>()

  constructor(
    readonly store: TaskStore,
    private readonly onComplete?: CompletionHandler,
  ) {}

  async start(input: { sessionID: string; command: string; cwd: string; label?: string }) {
    if (!input.command.trim()) throw new Error("Command must not be empty")
    const directory = path.resolve(input.cwd)
    const info = await stat(directory)
    if (!info.isDirectory()) throw new Error(`Working directory is not a directory: ${directory}`)

    await this.store.initialize()
    let task = this.store.createRecord({ ...input, cwd: directory })
    await this.store.save(task)

    const logHandle = await open(this.store.logPath(task.id), "a", 0o600)
    const shell = process.env.SHELL || "/bin/sh"
    const wrapper = 'eval "$1"\ncode=$?\nprintf "%s\\n" "$code" > "$2"\nexit "$code"'
    const child = spawn(shell, ["-c", wrapper, "opencode-background-task", input.command, this.store.exitPath(task.id)], {
      cwd: directory,
      detached: true,
      env: process.env,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    })

    try {
      await waitForSpawn(child)
    } catch (error) {
      await logHandle.close()
      task = { ...task, status: "failed", error: String(error), finishedAt: Date.now() }
      await this.store.save(task)
      throw error
    }

    await logHandle.close()
    child.unref()
    task = { ...task, status: "running", pid: child.pid, startedAt: Date.now() }
    await this.store.save(task)
    this.children.set(task.id, child)

    let exitHandled = false
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (exitHandled) return
      exitHandled = true
      void this.recordExit(task.id, code, signal)
    }
    child.once("exit", handleExit)
    child.once("error", (error) => void this.recordError(task.id, error))
    if (child.exitCode !== null || child.signalCode !== null) {
      handleExit(child.exitCode, child.signalCode)
    }
    return task
  }

  async kill(id: string, force = false) {
    const task = await this.store.get(id)
    if (!task) throw new Error(`Unknown background task: ${id}`)
    const refreshed = await this.store.refresh(task)
    if (["completed", "failed", "killed"].includes(refreshed.status)) return refreshed
    if (!refreshed.pid) throw new Error(`Task ${id} has no process ID`)

    const updated: BackgroundTask = { ...refreshed, status: "stopping", signal: force ? "SIGKILL" : "SIGTERM" }
    await this.store.save(updated)
    try {
      process.kill(process.platform === "win32" ? refreshed.pid : -refreshed.pid, force ? "SIGKILL" : "SIGTERM")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
    return (await this.store.refresh(updated))
  }

  killSync(id: string, force = false) {
    const task = this.store.getSync(id)
    if (!task) throw new Error(`Unknown background task: ${id}`)
    const refreshed = this.store.refreshSync(task)
    if (["completed", "failed", "killed"].includes(refreshed.status)) return refreshed
    if (!refreshed.pid) throw new Error(`Task ${id} has no process ID`)

    const updated: BackgroundTask = { ...refreshed, status: "stopping", signal: force ? "SIGKILL" : "SIGTERM" }
    this.store.saveSync(updated)
    try {
      process.kill(process.platform === "win32" ? refreshed.pid : -refreshed.pid, force ? "SIGKILL" : "SIGTERM")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
    return this.store.refreshSync(updated)
  }

  private async recordExit(id: string, code: number | null, signal: NodeJS.Signals | null) {
    this.children.delete(id)
    const current = await this.store.get(id)
    if (!current || ["completed", "failed", "killed"].includes(current.status)) return
    const task: BackgroundTask = {
      ...current,
      status: current.status === "stopping" || signal ? "killed" : code === 0 ? "completed" : "failed",
      exitCode: code ?? undefined,
      signal: signal ?? current.signal,
      finishedAt: Date.now(),
    }
    await this.store.save(task)
    await this.onComplete?.(task)
  }

  private async recordError(id: string, error: Error) {
    this.children.delete(id)
    const current = await this.store.get(id)
    if (!current) return
    const task: BackgroundTask = { ...current, status: "failed", error: error.message, finishedAt: Date.now() }
    await this.store.save(task)
    await this.onComplete?.(task)
  }
}

function waitForSpawn(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}
