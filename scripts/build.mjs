import { transformFileAsync } from "@babel/core"
import { execFile } from "node:child_process"
import { rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, "..")
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc")

await run(process.execPath, [tsc, "-p", path.join(root, "tsconfig.json")], { stdio: "inherit" })

const transformed = await transformFileAsync(path.join(root, "src", "tui.tsx"), {
  filename: path.join(root, "src", "tui.tsx"),
  sourceType: "module",
  presets: [
    ["babel-preset-solid", { generate: "universal", moduleName: "@opentui/solid" }],
    ["@babel/preset-typescript", { allExtensions: true, isTSX: true }],
  ],
})

if (!transformed?.code) throw new Error("Solid TUI build produced no output")
await writeFile(path.join(root, "dist", "tui.js"), `${transformed.code}\n`)
await rm(path.join(root, "dist", "tui.jsx"), { force: true })
