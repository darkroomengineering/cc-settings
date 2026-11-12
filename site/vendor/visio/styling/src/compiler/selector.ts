const COMBINATORS = new Set([">", "+", "~"]);

const PSEUDO_ELEMENT =
  /(?:::[a-zA-Z\-]+(?:\([^\)]*\))?|:(?:before|after|first-line|first-letter))$/v;

/**
 * Every character of `text`, with whether it sits at the top level and
 * whether it is literal. The top level is outside quotes, parentheses and
 * attribute brackets, so `[class~=a]` holds no combinator. An opening
 * parenthesis or bracket counts at the depth before it, a closing one at
 * the depth after it. A literal character is part of a string or escaped:
 * a quote, the characters between two quotes, and a backslash with the
 * character it escapes (`.a\]`). A literal character is never at the top
 * level and changes no depth.
 *
 * @yields {[string, boolean, boolean]} Each character with whether it is top level and whether it is literal.
 */
export function* topLevel(text: string): Generator<[string, boolean, boolean]> {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (const ch of text) {
    if (escaped || ch === "\\") {
      escaped = !escaped;
      yield [ch, false, true];
    } else if (quote) {
      if (ch === quote) {
        quote = "";
      }

      yield [ch, false, true];
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      yield [ch, false, true];
    } else if (ch === "(" || ch === "[") {
      yield [ch, depth === 0, false];
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      depth -= 1;
      yield [ch, depth === 0, false];
    } else {
      yield [ch, depth === 0, false];
    }
  }
}

/**
 * The string index of every `&` in `text` that stands for the element: not
 * in a string (`[data-x="&"]`) and not escaped (`\&`), at any depth.
 *
 * @yields {number} The index of each such `&`.
 */
export function* ampersands(text: string): Generator<number> {
  let index = 0;

  for (const [ch, , literal] of topLevel(text)) {
    if (ch === "&" && !literal) {
      yield index;
    }

    index += ch.length;
  }
}

export function hasAmp(text: string): boolean {
  return !ampersands(text).next().done;
}

export function replaceAmp(text: string, by: string): string {
  let out = "";
  let from = 0;

  for (const at of ampersands(text)) {
    out += text.slice(from, at) + by;
    from = at + 1;
  }

  return out + text.slice(from);
}

export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let cur = "";

  for (const [ch, top] of topLevel(text)) {
    if (top && ch === separator) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  parts.push(cur);

  return parts.filter(Boolean);
}

export function splitList(selector: string): string[] {
  return splitTopLevel(selector, ",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Turns an authoring key into a template: `:hover, :focus` -> `&:hover, &:focus`, `& > *` stays. */
export function toTemplate(key: string): string {
  return splitList(key)
    .map((part) => (hasAmp(part) ? part : `&${part}`))
    .join(", ");
}

/** Applies `child` inside `parent`, distributing over lists. Either may be empty. */
export function nest(parent: string, child: string): string {
  if (!parent) {
    return child;
  }

  if (!child) {
    return parent;
  }

  return splitList(child)
    .flatMap((c) => splitList(parent).map((p) => replaceAmp(c, p)))
    .join(", ");
}

interface Token {
  kind: "compound" | "combinator";
  text: string;
}

/** Splits a selector fragment into compounds and combinators. */
function tokenize(fragment: string): Token[] {
  const tokens: Token[] = [];
  let cur = "";

  function flush() {
    if (cur) {
      tokens.push({ kind: "compound", text: cur });
    }

    cur = "";
  }

  for (const [ch, top] of topLevel(fragment)) {
    const separator = top && (ch === " " || ch === "\t" || COMBINATORS.has(ch));

    if (!separator) {
      cur += ch;
      continue;
    }

    flush();
    const last = tokens.at(-1);

    if (COMBINATORS.has(ch)) {
      if (last?.kind === "combinator") {
        last.text = ch;
      } else {
        tokens.push({ kind: "combinator", text: ch });
      }
    } else if (last?.kind !== "combinator") {
      tokens.push({ kind: "combinator", text: " " });
    }
  }

  flush();

  return tokens;
}

function wrap(compound: string): string {
  const m = compound.match(PSEUDO_ELEMENT);
  const pseudo = m ? m[0] : "";
  const rest = m ? compound.slice(0, -pseudo.length) : compound;

  return rest ? `:where(${rest})${pseudo}` : pseudo;
}

/** Whether `text` mentions `&` at the top level. */
function hasTopLevelAmp(text: string): boolean {
  for (const [ch, top] of topLevel(text)) {
    if (top && ch === "&") {
      return true;
    }
  }

  return false;
}

/**
 * Splits a compound into its simple selectors at the top level:
 * `.a:has(.b)::after` -> `.a`, `:has(.b)`, `::after`. `&` is its own part.
 */
function simpleSelectors(compound: string): string[] {
  const parts: string[] = [];
  let cur = "";

  for (const [ch, top] of topLevel(compound)) {
    const starts =
      top &&
      (ch === "." ||
        ch === "#" ||
        ch === "[" ||
        ch === "&" ||
        (ch === ":" && !cur.endsWith(":")));

    if (starts && cur) {
      parts.push(cur);
      cur = "";
    }

    cur += ch;
  }

  if (cur) {
    parts.push(cur);
  }

  return parts;
}

/** `:has(.a &, > &)` -> its arguments, each applied as a template of its own. */
function renderFunctional(simple: string, base: string): string {
  const open = simple.indexOf("(");
  const name = simple.slice(0, open);
  const inner = simple.slice(open + 1, simple.lastIndexOf(")"));
  const args = splitList(inner).map((arg) => applyOne(arg, base).trim());

  return `${name}(${args.join(", ")})`;
}

/**
 * Renders one compound. The atom class contributes the selector's whole
 * specificity, so everything else is wrapped in `:where()`. A compound
 * that mentions `&` only inside a functional pseudo-class (`.parent:has(&)`)
 * carries the class through that pseudo-class instead, once per selector,
 * and the pseudo-class's own arguments are templates in turn.
 */
function renderCompound(
  compound: string,
  base: string,
  carry: boolean
): string {
  if (compound === "&") {
    return base;
  }

  if (!hasAmp(compound)) {
    return wrap(compound);
  }

  const substituted = replaceAmp(compound, base);

  if (!hasTopLevelAmp(compound) && !carry) {
    return wrap(substituted);
  }

  let out = "";
  let group = "";
  let carried = !carry;

  function flush() {
    if (group) {
      out += wrap(replaceAmp(group, base));
    }

    group = "";
  }

  for (const part of simpleSelectors(compound)) {
    if (part === "&") {
      flush();
      out += base;
    } else if (hasAmp(part) && part.includes("(") && !carried) {
      flush();
      out += renderFunctional(part, base);
      carried = true;
    } else {
      group += part;
    }
  }

  flush();

  return out;
}

function applyOne(template: string, base: string): string {
  // A pseudo-element on the base stays last. A condition applies over a
  // selector that may already end in one (`hover` around `'::after'`), and a
  // pseudo-class after a pseudo-element is invalid, so the browser would
  // drop the rule: `&:hover` over `.x::after` is `.x:where(:hover)::after`.
  const m = base.match(PSEUDO_ELEMENT);
  const pseudo = m ? m[0] : "";
  const core = pseudo ? base.slice(0, -pseudo.length) : base;
  const tokens = tokenize(template);

  // Whitespace at the very start or end of the template means nothing.
  if (tokens[0]?.kind === "combinator" && tokens[0].text === " ") {
    tokens.shift();
  }

  const last = tokens.at(-1);

  if (last?.kind === "combinator" && last.text === " ") {
    tokens.pop();
  }

  // Without `&` at the top level, the first compound that has it inside a
  // functional pseudo-class carries the class; every other one is wrapped.
  let carry = !tokens.some(
    (t) => t.kind === "compound" && hasTopLevelAmp(t.text)
  );

  return tokens
    .map((t) => {
      if (t.kind === "combinator") {
        return t.text === " " ? " " : ` ${t.text} `;
      }

      const mentions = hasAmp(t.text);
      const carries = carry && !hasTopLevelAmp(t.text) && mentions;

      if (carries) {
        carry = false;
      }

      const rendered = renderCompound(t.text, core, carries);

      return mentions ? rendered + pseudo : rendered;
    })
    .join("");
}

/**
 * Replaces `&` in `template` with `base` and wraps every compound except
 * `base` in `:where()`. Both may be selector lists; the result is the
 * product of the two.
 */
export function applyTemplate(template: string, base: string): string {
  if (!template) {
    return base;
  }

  return splitList(template)
    .flatMap((t) => splitList(base).map((b) => applyOne(t, b)))
    .join(", ");
}

/** The media query every `:hover` has to sit under. */
export const HOVER_MEDIA = "(hover: hover) and (pointer: fine)";

/** Whether a selector or condition names `:hover`. */
export function mentionsHover(text: string): boolean {
  return /:hover(?![\w\-])/iv.test(text);
}
