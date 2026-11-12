/** A GROQ query, typed as its literal, which is how `fetchQuery` finds its result type. */
export function defineQuery<const Q extends string>(query: Q): Q {
  return query;
}
