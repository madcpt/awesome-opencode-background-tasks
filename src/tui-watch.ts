import { watch, type FSWatcher } from "node:fs"
import type { TaskStore } from "./store.js"

export function watchTaskStore(store: TaskStore, onChange: () => void) {
  store.initializeSync()
  const watchers: FSWatcher[] = []
  for (const directory of [store.jobsDir, store.exitsDir, store.logsDir]) {
    try {
      watchers.push(watch(directory, { persistent: false }, onChange))
    } catch {
      // The server may not have created a directory yet; the next refresh retries through the store.
    }
  }
  return () => watchers.forEach((watcher) => watcher.close())
}
