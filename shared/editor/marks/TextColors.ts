import { MarkSpec, MarkType } from "prosemirror-model";
import { Command } from "prosemirror-state";
import Mark from "./Mark";

export default class TextColors extends Mark {
  static presetColors = [
    { name: "Red", hex: "#e03131" },
    { name: "Orange", hex: "#fd7e14" },
    { name: "Yellow", hex: "#f59f00" },
    { name: "Green", hex: "#2f9e44" },
    { name: "Blue", hex: "#1971c2" },
    { name: "Purple", hex: "#9c36b5" },
    { name: "Gray", hex: "#868e96" },
  ];

  static isPresetColor(color: string): boolean {
    return TextColors.presetColors.some((p) => p.hex === color);
  }

  get name() {
    return "text_color";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        color: { default: null },
      },
      parseDOM: [
        {
          style: "color",
          getAttrs: (value) =>
            typeof value === "string" ? { color: value } : false,
        },
      ],
      toDOM: (mark) => [
        "span",
        { style: `color: ${mark.attrs.color}` },
        0,
      ],
    };
  }

  commands({ type }: { type: MarkType }) {
    return (attrs: { color: string | null }): Command =>
      (state, dispatch) => {
        const { from, to } = state.selection;
        if (from === to) {
          return false;
        }
        if (dispatch) {
          const tr = state.tr.removeMark(from, to, type);
          if (attrs.color) {
            tr.addMark(from, to, type.create({ color: attrs.color }));
          }
          dispatch(tr);
        }
        return true;
      };
  }

  toMarkdown() {
    return {
      open: (_state: any, mark: any) =>
        `<span style="color: ${mark.attrs.color}">`,
      close: "</span>",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }

  parseMarkdown() {
    return {
      mark: "text_color",
      getAttrs: (tok: any) => ({ color: tok.attrGet("color") }),
    };
  }
}