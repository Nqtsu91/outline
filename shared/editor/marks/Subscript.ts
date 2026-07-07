import { toggleMark } from "prosemirror-commands";
import type { MarkSpec, MarkType } from "prosemirror-model";
import subscriptRule from "../rules/subscript";
import Mark from "./Mark";

export default class Subscript extends Mark {
  get name() {
    return "sub";
  }

  get schema(): MarkSpec {
    return {
      excludes: "sup",
      parseDOM: [
        { tag: "sub" },
        {
          style: "vertical-align",
          getAttrs: (value) => (value === "sub" ? null : false),
        },
      ],
      toDOM: () => ["sub", 0],
    };
  }

  get rulePlugins() {
    return [subscriptRule];
  }

  keys({ type }: { type: MarkType }) {
    return {
      "Mod-,": toggleMark(type),
    };
  }

  get markdownToken() {
    return "sub";
  }

  toMarkdown() {
    return {
      open: "~",
      close: "~",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }

  parseMarkdown() {
    return { mark: "sub" };
  }
}
