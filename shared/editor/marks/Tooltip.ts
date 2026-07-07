import type Token from "markdown-it/lib/token.mjs";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type {
  Attrs,
  MarkSpec,
  MarkType,
  Node,
  Mark as ProsemirrorMark,
} from "prosemirror-model";
import type { Primitive } from "utility-types";
import { addTooltip, removeTooltip, updateTooltip } from "../commands/tooltip";
import { toggleMark } from "../commands/toggleMark";
import tooltipRule from "../rules/tooltip";
import Mark from "./Mark";

/**
 * A mark that associates hover text (a tooltip / definition) with a span of
 * text. Rendered as an <abbr> element so browsers show the title on hover.
 */
export default class Tooltip extends Mark {
  get name() {
    return "tooltip";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        title: {
          default: "",
          validate: "string",
        },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "abbr[title]",
          getAttrs: (dom: HTMLElement) => ({
            title: dom.getAttribute("title") || "",
          }),
        },
      ],
      toDOM: (node) => [
        "abbr",
        {
          title: node.attrs.title,
          class: "tooltip",
        },
        0,
      ],
    };
  }

  get rulePlugins() {
    return [tooltipRule];
  }

  commands({ type }: { type: MarkType }) {
    return {
      tooltip: (attrs?: Attrs) =>
        toggleMark(type, attrs as Record<string, Primitive>),
      addTooltip,
      updateTooltip,
      removeTooltip,
    };
  }

  get markdownToken() {
    return "tooltip";
  }

  toMarkdown() {
    return {
      open: "[[",
      close: (
        _state: MarkdownSerializerState,
        mark: ProsemirrorMark,
        _parent: Node,
        _index: number
      ) => `|${mark.attrs.title}]]`,
      mixable: false,
      expelEnclosingWhitespace: true,
    };
  }

  parseMarkdown() {
    return {
      mark: "tooltip",
      getAttrs: (token: Token) => ({
        title: token.attrGet("title") || "",
      }),
    };
  }
}
