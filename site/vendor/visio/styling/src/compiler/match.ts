export function group(match: RegExpMatchArray, name: string): string {
  const value = match.groups?.[name];

  if (value === undefined) {
    throw new Error(
      `[@visio/styling] The pattern matched without its \`${name}\` group.`
    );
  }

  return value;
}
