import path from "path";

export function resolvePreludeRoot(): string {
  if (process.env.PRELUDE_ROOT) {
    return path.resolve(process.env.PRELUDE_ROOT);
  }
  return path.join(process.cwd(), ".context");
}

export function resolveProjectContextDir(projectName: string) {
  const root = resolvePreludeRoot();

  // If PRELUDE_ROOT is set → external brain mode
  if (process.env.PRELUDE_ROOT) {
    return path.join(root, projectName);
  }

  // Embedded mode
  return root;
}