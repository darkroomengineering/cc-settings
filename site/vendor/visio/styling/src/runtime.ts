export type Layer = Record<string, string>;

export interface CompiledRecipe {
  base: Layer;
  variants: Record<string, Record<string, Layer>>;
  compound: { when: Record<string, string | boolean>; layer: Layer }[];
  defaults: Record<string, string | boolean>;
}

export type RecipeArgs = Record<string, string | boolean | undefined | null>;

export function recipe(def: CompiledRecipe): (input?: RecipeArgs) => string {
  const cache = new Map<string, string>();
  const variantNames = Object.keys(def.variants);

  return (input) => {
    let sig = "";
    const chosen: Record<string, string> = {};

    for (const name of variantNames) {
      const raw = input?.[name] ?? def.defaults[name];

      if (raw === undefined || raw === null) {
        continue;
      }

      const v = String(raw);
      chosen[name] = v;
      sig += `${name}=${v};`;
    }

    const hit = cache.get(sig);

    if (hit !== undefined) {
      return hit;
    }

    const merged = { ...def.base };

    for (const [name, options] of Object.entries(def.variants)) {
      const v = chosen[name];

      if (v === undefined) {
        continue;
      }

      Object.assign(merged, options[v]);
    }

    for (const c of def.compound) {
      let match = true;

      for (const [k, want] of Object.entries(c.when)) {
        if (chosen[k] !== String(want)) {
          match = false;
          break;
        }
      }

      if (match) {
        Object.assign(merged, c.layer);
      }
    }

    const out = Object.values(merged).join(" ");
    cache.set(sig, out);

    return out;
  };
}
