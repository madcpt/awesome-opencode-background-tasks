import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { TaskManager } from "../src/manager.js"
import { TaskStore } from "../src/store.js"

test("runs a command without blocking and captures its output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-bg-run-"))
  try {
    const store = new TaskStore(root, root)
    const completed = new Promise<void>((resolve) => {
      const manager = new TaskManager(store, async () => resolve())
      void manager
        .start({ sessionID: "session-1", command: "printf 'hello from background'", cwd: root })
        .then((task) => assert.equal(task.status, "running"))
    })

    await Promise.race([
      completed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("background command timed out")), 5000)),
    ])
    const [task] = await store.list()
    assert.equal((await store.refresh(task)).status, "completed")
    assert.equal(await store.tail(task.id, 10), "hello from background")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("kills a detached process group", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-bg-kill-"))
  try {
    const store = new TaskStore(root, root)
    const manager = new TaskManager(store)
    const task = await manager.start({ sessionID: "session-1", command: "sleep 30", cwd: root })
    const killed = await manager.kill(task.id)
    assert.ok(["stopping", "killed"].includes(killed.status))
    await waitFor(async () => (await store.get(task.id))?.status === "killed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function waitFor(predicate: () => Promise<boolean>, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("condition timed out")
}
