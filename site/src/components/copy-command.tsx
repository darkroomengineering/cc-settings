import { css, dp } from "@visio/styling";
import { createSignal } from "solid-js";

import { t } from "../styles/tokens";

type CopyState = "idle" | "copied" | "failed";

const LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Select and copy",
};

const STATUS: Record<CopyState, string> = {
  idle: "",
  copied: "Copied to the clipboard.",
  failed: "Could not copy. Select the command and copy it.",
};

const s = css({
  row: {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    columnGap: dp(8),
    maxInlineSize: "100%",
    backgroundColor: t.colors.well,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: t.colors.rule,
    borderRadius: "8px",
  },
  command: {
    ...t.type.code,
    flexGrow: 1,
    minInlineSize: 0,
    paddingBlock: dp(12),
    paddingInlineStart: dp(16),
    paddingInlineEnd: dp(8),
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: t.colors.ink,
  },
  // Read by screen readers, not drawn.
  status: {
    position: "absolute",
    inlineSize: "1px",
    blockSize: "1px",
    overflow: "clip",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  prompt: {
    color: t.colors.accent,
    userSelect: "none",
  },
  button: {
    ...t.type.note,
    flexShrink: 0,
    minInlineSize: "72px",
    minBlockSize: "44px",
    paddingInline: dp(12),
    color: t.colors.ink,
    borderInlineStartWidth: "1px",
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.colors.rule,
    cursor: "pointer",
    hover: { color: t.colors.accent },
    ":active": { color: t.colors.accent },
    ":focus-visible": {
      outlineColor: t.colors.accent,
      outlineOffset: "-3px",
    },
  },
});

// A shell command with a button that copies it.
export function CopyCommand(props: { command: string; label: string }) {
  const [state, setState] = createSignal<CopyState>("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    clearTimeout(timer);

    try {
      await navigator.clipboard.writeText(props.command);
      setState("copied");
    } catch {
      setState("failed");
    }

    timer = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div class={s.row}>
      <code class={s.command}>
        <span class={s.prompt} aria-hidden="true">
          ${" "}
        </span>
        {props.command}
      </code>
      <button
        type="button"
        class={s.button}
        aria-label={`${LABEL[state()]} ${props.label}`}
        onClick={copy}
      >
        {LABEL[state()]}
      </button>
      <span class={s.status} role="status">
        {STATUS[state()]}
      </span>
    </div>
  );
}
