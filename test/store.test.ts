import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { filterByStatus, TaskStore } from "../src/store.js"

test("stores, lists, filters, and tails task records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-bg-store-"))
  try {
    const store = new TaskStore("/example/project", root)
    await store.initialize()
    const task = store.createRecord({ sessionID: "session-1", command: "build", cwd: "/example/project", label: "build" })
    await store.save(task)
    await writeFile(store.logPath(task.id), "one\ntwo\nthree\n")

    assert.equal((await store.get(task.id))?.command, "build")
    assert.deepEqual((await store.list()).map((item) => item.id), [task.id])
    assert.deepEqual(store.listSync().map((item) => item.id), [task.id])
    assert.equal(await store.tail(task.id, 2), "two\nthree")
    assert.equal(store.tailSync(task.id, 2), "two\nthree")
    assert.equal(filterByStatus(await store.list(), "running").length, 1)
    assert.equal(filterByStatus([{ ...task, status: "completed" }], "finished").length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reconciles a recorded exit code", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-bg-exit-"))
  try {
    const store = new TaskStore("/example/project", root)
    await store.initialize()
    const task = { ...store.createRecord({ sessionID: "s", command: "false", cwd: "/tmp" }), status: "running" as const }
    await store.save(task)
    await writeFile(store.exitPath(task.id), "7\n")

    const refreshed = await store.refresh(task)
    assert.equal(refreshed.status, "failed")
    assert.equal(refreshed.exitCode, 7)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
