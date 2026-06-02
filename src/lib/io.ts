// IO helpers shared across hook scripts.

/** Drain stdin to a UTF-8 string. Resolves when the stream closes. */
export function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c) => chunks.push(c as Uint8Array));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
