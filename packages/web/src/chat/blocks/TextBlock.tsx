import { For, type JSX } from "solid-js";

/**
 * TextBlock — renders a "text" segment of a ChatMessage as lightly-formatted
 * prose. Hand-rolled mini-markdown: paragraphs, inline code, bold, italic,
 * links. No markdown library, no innerHTML — JSX nodes are built by hand.
 *
 * Typography is inherited from the parent MessageRow (font-serif, 15px).
 */

export interface TextBlockProps {
  content: string;
  /** Role of the parent message — reserved for future role-specific styling. */
  role?: "user" | "assistant" | "system";
}

type Inline =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "link"; text: string; href: string };

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const CODE_RE = /`([^`\n]+)`/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const ITALIC_RE = /(?:\*([^*\n]+)\*|_([^_\n]+)_)/g;

/**
 * Tokenise a single paragraph into inline segments. Order of operations:
 * inline code first (so ** inside ` ` is preserved verbatim), then links,
 * then bold, then italic. Each pass consumes already-tokenised "text"
 * nodes and leaves other kinds untouched.
 */
function tokenizeInline(src: string): Inline[] {
  let nodes: Inline[] = [{ kind: "text", value: src }];

  const pass = (
    re: RegExp,
    make: (m: RegExpExecArray) => Inline | null,
  ): void => {
    const out: Inline[] = [];
    for (const n of nodes) {
      if (n.kind !== "text") {
        out.push(n);
        continue;
      }
      let lastIndex = 0;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(n.value)) !== null) {
        if (m.index > lastIndex) {
          out.push({ kind: "text", value: n.value.slice(lastIndex, m.index) });
        }
        const node = make(m);
        if (node) out.push(node);
        else out.push({ kind: "text", value: m[0] });
        lastIndex = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (lastIndex < n.value.length) {
        out.push({ kind: "text", value: n.value.slice(lastIndex) });
      }
    }
    nodes = out;
  };

  pass(CODE_RE, (m) => ({ kind: "code", value: m[1] }));
  pass(LINK_RE, (m) => {
    const href = m[2];
    if (!/^https?:\/\//i.test(href)) return null;
    return { kind: "link", text: m[1], href };
  });
  pass(BOLD_RE, (m) => ({ kind: "bold", value: m[1] }));
  pass(ITALIC_RE, (m) => ({
    kind: "italic",
    value: m[1] ?? m[2] ?? "",
  }));

  return nodes;
}

/** Render a text node, preserving `\n` as <br/>. */
function renderText(value: string): JSX.Element {
  const parts = value.split("\n");
  return (
    <>
      <For each={parts}>
        {(chunk, i) => (
          <>
            {chunk}
            {i() < parts.length - 1 ? <br /> : null}
          </>
        )}
      </For>
    </>
  );
}

function renderInline(node: Inline): JSX.Element {
  switch (node.kind) {
    case "text":
      return renderText(node.value);
    case "code":
      return (
        <code class="font-mono text-[0.92em] bg-codeBg px-1 py-0.5 rounded-sm">
          {node.value}
        </code>
      );
    case "bold":
      return <strong class="font-semibold">{node.value}</strong>;
    case "italic":
      return <em>{node.value}</em>;
    case "link":
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:text-accent-hover underline underline-offset-2"
        >
          {node.text}
        </a>
      );
  }
}

export function TextBlock(props: TextBlockProps): JSX.Element {
  const paragraphs = () =>
    props.content
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .filter((p) => p.length > 0);

  return (
    <For each={paragraphs()}>
      {(para) => {
        const nodes = tokenizeInline(para);
        return (
          <p class="mb-3 last:mb-0">
            <For each={nodes}>{(n) => renderInline(n)}</For>
          </p>
        );
      }}
    </For>
  );
}

export default TextBlock;
