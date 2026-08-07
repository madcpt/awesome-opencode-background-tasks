import assert from "node:assert/strict"
import test from "node:test"
import { backgroundTaskPolicy } from "../src/policy.js"

test("policy routes long-running shell work to background_bash", () => {
  assert.match(backgroundTaskPolicy, /background_bash/)
  assert.match(backgroundTaskPolicy, /interactive or TTY commands/)
  assert.match(backgroundTaskPolicy, /background_output/)
})
