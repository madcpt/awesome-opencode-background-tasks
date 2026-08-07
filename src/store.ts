import { createHash, randomBytes } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { BackgroundTask, TaskStatus } from "./types.js"
import { terminalStatuses } from "./types.js"

function defaultDataRoot() {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share")
  return path.join(dataHome, "opencode", "background-tasks")
}

export class TaskStore {
  readonly root: string
  readonly project: string
  readonly jobsDir: string
  readonly logsDir: string
  readonly exitsDir: string

  constructor(worktree: string, dataRoot = process.env.OPENCODE_BACKGROUND_TASKS_DIR ?? defaultDataRoot()) {
    this.project = createHash("sha256").update(path.resolve(worktree)).digest("hex").slice(0, 16)
    this.root = path.join(dataRoot, this.project)
    this.jobsDir = path.join(this.root, "jobs")
    this.logsDir = path.join(this.root, "logs")
    this.exitsDir = path.join(this.root, "exits")
  }

  async initialize() {
    await Promise.all([
      mkdir(this.jobsDir, { recursive: true }),
      mkdir(this.logsDir, { recursive: true }),
      mkdir(this.exitsDir, { recursive: true }),
    ])
  }

  initializeSync() {
    mkdirSync(this.jobsDir, { recursive: true })
    mkdirSync(this.logsDir, { recursive: true })
    mkdirSync(this.exitsDir, { recursive: true })
  }

  createRecord(input: Pick<BackgroundTask, "sessionID" | "label" | "command" | "cwd">): BackgroundTask {
    return {
      ...input,
      id: `bg_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
      project: this.project,
      status: "queued",
      createdAt: Date.now(),
    }
  }

  logPath(id: string) {
    this.assertID(id)
    return path.join(this.logsDir, `${id}.log`)
  }

  exitPath(id: string) {
    this.assertID(id)
    return path.join(this.exitsDir, `${id}.exit`)
  }

  async save(task: BackgroundTask) {
    this.assertID(task.id)
    const target = path.join(this.jobsDir, `${task.id}.json`)
    const temporary = `${target}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`
    await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, target)
  }

  saveSync(task: BackgroundTask) {
    this.assertID(task.id)
    const target = path.join(this.jobsDir, `${task.id}.json`)
    const temporary = `${target}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`
    writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, target)
  }

  async get(id: string) {
    this.assertID(id)
    try {
      return JSON.parse(await readFile(path.join(this.jobsDir, `${id}.json`), "utf8")) as BackgroundTask
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  getSync(id: string) {
    this.assertID(id)
    try {
      return JSON.parse(readFileSync(path.join(this.jobsDir, `${id}.json`), "utf8")) as BackgroundTask
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async list() {
    let names: string[]
    try {
      names = await readdir(this.jobsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    const tasks = await Promise.all(
      names.filter((name) => /^bg_[a-z0-9_]+\.json$/.test(name)).map((name) => this.get(name.slice(0, -5))),
    )
    return tasks.filter((task): task is BackgroundTask => Boolean(task)).sort((a, b) => b.createdAt - a.createdAt)
  }

  listSync() {
    let names: string[]
    try {
      names = readdirSync(this.jobsDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
    return names
      .filter((name) => /^bg_[a-z0-9_]+\.json$/.test(name))
      .map((name) => this.getSync(name.slice(0, -5)))
      .filter((task): task is BackgroundTask => Boolean(task))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async refresh(task: BackgroundTask) {
    if (terminalStatuses.has(task.status)) return task

    const exitCode = await this.readExitCode(task.id)
    if (exitCode !== undefined) {
      const updated: BackgroundTask = {
        ...task,
        status: task.status === "stopping" ? "killed" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        finishedAt: task.finishedAt ?? Date.now(),
      }
      await this.save(updated)
      return updated
    }

    if (task.pid && !isProcessAlive(task.pid)) {
      const updated: BackgroundTask = {
        ...task,
        status: task.status === "stopping" ? "killed" : "failed",
        error: task.status === "stopping" ? task.error : "Process exited before recording an exit code",
        finishedAt: task.finishedAt ?? Date.now(),
      }
      await this.save(updated)
      return updated
    }

    return task
  }

  refreshSync(task: BackgroundTask) {
    if (terminalStatuses.has(task.status)) return task

    const exitCode = this.readExitCodeSync(task.id)
    if (exitCode !== undefined) {
      const updated: BackgroundTask = {
        ...task,
        status: task.status === "stopping" ? "killed" : exitCode === 0 ? "completed" : "failed",
        exitCode,
        finishedAt: task.finishedAt ?? Date.now(),
      }
      this.saveSync(updated)
      return updated
    }

    if (task.pid && !isProcessAlive(task.pid)) {
      const updated: BackgroundTask = {
        ...task,
        status: task.status === "stopping" ? "killed" : "failed",
        error: task.status === "stopping" ? task.error : "Process exited before recording an exit code",
        finishedAt: task.finishedAt ?? Date.now(),
      }
      this.saveSync(updated)
      return updated
    }

    return task
  }

  async tail(id: string, lines: number) {
    const file = this.logPath(id)
    try {
      const info = await stat(file)
      const bytes = Math.min(info.size, Math.max(64 * 1024, lines * 512))
      const handle = await open(file, "r")
      try {
        const buffer = Buffer.alloc(bytes)
        await handle.read(buffer, 0, bytes, info.size - bytes)
        const output = buffer.toString("utf8").split("\n")
        return output.slice(Math.max(0, output.length - lines - 1)).join("\n").trimEnd()
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw error
    }
  }

  tailSync(id: string, lines: number) {
    const file = this.logPath(id)
    try {
      const info = statSync(file)
      const bytes = Math.min(info.size, Math.max(64 * 1024, lines * 512))
      const descriptor = openSync(file, "r")
      try {
        const buffer = Buffer.alloc(bytes)
        readSync(descriptor, buffer, 0, bytes, info.size - bytes)
        const output = buffer.toString("utf8").split("\n")
        return output.slice(Math.max(0, output.length - lines - 1)).join("\n").trimEnd()
      } finally {
        closeSync(descriptor)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
      throw error
    }
  }

  private async readExitCode(id: string) {
    try {
      const value = Number.parseInt((await readFile(this.exitPath(id), "utf8")).trim(), 10)
      return Number.isFinite(value) ? value : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  private readExitCodeSync(id: string) {
    try {
      const value = Number.parseInt(readFileSync(this.exitPath(id), "utf8").trim(), 10)
      return Number.isFinite(value) ? value : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  private assertID(id: string) {
    if (!/^bg_[a-z0-9_]+$/.test(id)) throw new Error(`Invalid task ID: ${id}`)
  }
}

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function filterByStatus(tasks: BackgroundTask[], status: "all" | "running" | "finished") {
  if (status === "all") return tasks
  return tasks.filter((task) => (status === "finished") === terminalStatuses.has(task.status as TaskStatus))
}
