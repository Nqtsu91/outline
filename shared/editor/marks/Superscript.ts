import { toggleMark } from "prosemirror-commands";
import type { MarkSpec, MarkType } from "prosemirror-model";
import { markInputRuleForPattern } from "../lib/markInputRule";
import superscriptRule from "../rules/superscript";
import Mark from "./Mark";

export default class Superscript extends Mark {
  get name() {
    return "sup";
  }

  get schema(): MarkSpec {
    return {
      excludes: "sub",
      parseDOM: [
        { tag: "sup" },
        {
          style: "vertical-align",
          getAttrs: (value) => (value === "super" ? null : false),
        },
      ],
      toDOM: () => ["sup", 0],
    };
  }

  get rulePlugins() {
    return [superscriptRule];
  }

  inputRules({ type }: { type: MarkType }) {
    return [markInputRuleForPattern("^", type)];
  }

  keys({ type }: { type: MarkType }) {
    return {
      "Mod-.": toggleMark(type),
    };
  }

  get markdownToken() {
    return "sup";
  }

  toMarkdown() {
    return {
      open: "^",
      close: "^",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }

  parseMarkdown() {
    return { mark: "sup" };
  }
}
