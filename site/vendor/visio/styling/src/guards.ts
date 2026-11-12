export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function hasRef<T>(v: T): v is T & { ref: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "ref" in v &&
    typeof v.ref === "string"
  );
}
