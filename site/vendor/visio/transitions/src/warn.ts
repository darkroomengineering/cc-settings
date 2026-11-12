/** Call only under `import.meta.env.DEV`, so the build drops it. */
export function warn(message: string): void {
  console.warn(`[@visio/transitions] ${message}`);
}
