import path from "node:path"

export function taskProjectPath(input: { directory: string; worktree?: string }) {
  const worktree = input.worktree?.trim()
  if (!worktree || worktree === path.parse(worktree).root) return input.directory
  return worktree
}
