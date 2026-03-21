#!/bin/bash
set -e

TASK_DIR="CLAUDE_TASKS"
TASKS=(
  01-source-scanner-module
  02-extend-architecture-schema
  03-wire-scanner-into-infer
  04-update-formatters
  05-source-scanner-tests
)

for task in "${TASKS[@]}"; do
  echo ""
  echo "========================================="
  echo "  Running: $task"
  echo "========================================="
  claude -p "$(cat ${TASK_DIR}/${task}.md)" --allowedTools Edit Bash Read
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