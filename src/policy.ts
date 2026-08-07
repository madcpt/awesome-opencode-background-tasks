export const backgroundTaskPolicy = `
## Background shell routing

Choose the background task tools automatically:

- Use background_bash instead of bash when a command is likely to take more than a few seconds, including tests, builds, installs, downloads, long sleeps, watch/dev servers, and large data jobs.
- Use background_bash when the user says "in the background", "keep working", or asks you to start a long-running process.
- After starting a background task, report its task ID and continue with the user's other work. Use background_tasks, background_output, and background_kill to manage it yourself when needed.
- Use bash for quick commands whose output is needed immediately, interactive or TTY commands, and commands that require stdin.
- Never wait in the foreground for a long command just to report its final output.
`
