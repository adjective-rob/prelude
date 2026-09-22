#!/bin/bash
set -e

TASK_DIR="CLAUDE_TASKS"
TASKS=(
  00-context-dir-resolution
  01-map-scanner
  02-map-schema-and-write
  03-map-formatters
  04-locate
  05-mcp-tools-single-project
  06-diff-command-and-check
  07-workspace-registry
  08-workspace-serve
  09-dogfood-and-release
)

for task in "${TASKS[@]}"; do
  echo ""
  echo "========================================="
  echo "  Running: $task"
  echo "========================================="
  claude -p "Read CLAUDE_TASKS/README.md first, then execute this task:\n\n$(cat ${TASK_DIR}/${task}.md)" --allowedTools Edit Write Bash Read Grep Glob
  pnpm build && pnpm exec vitest run
  git add -A
  git commit -m "prelude: ${task}" || echo "Nothing to commit"
  echo "✅ ${task} done"
done

echo ""
echo "========================================="
echo "  All tasks complete."
echo "========================================="
echo "  Verify: pnpm build && pnpm test"
echo "  git push -u origin $(git branch --show-current)"