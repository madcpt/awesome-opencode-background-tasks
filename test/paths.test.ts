import assert from "node:assert/strict"
import test from "node:test"
import { taskProjectPath } from "../src/paths.js"

test("uses the session directory when OpenCode reports a filesystem root worktree", () => {
  assert.equal(taskProjectPath({ directory: "/workspace/app", worktree: "/" }), "/workspace/app")
  assert.equal(taskProjectPath({ directory: "/workspace/app", worktree: "/workspace" }), "/workspace")
})
