import { isHexColor } from "class-validator";
import { toggleMark } from "prosemirror-commands";
import type { MarkSpec, MarkType } from "prosemirror-model";
import Mark from "./Mark";

interface PresetTextColor {
  hex: string;
  name: string;
}

export default class TextColor extends Mark {
  /** Preset text colors available for selection */
  static presetColors: PresetTextColor[] = [
    { hex: "#E03E3E", name: "Red" },
    { hex: "#D9730D", name: "Orange" },
    { hex: "#CB912F", name: "Yellow" },
    { hex: "#448361", name: "Green" },
    { hex: "#337EA9", name: "Blue" },
    { hex: "#9065B0", name: "Purple" },
  ];

  /**
   * Checks if a color is one of the text color preset colors.
   *
   * @param color - A hex color string to check.
   * @returns true if the color matches a preset color's hex value.
   */
  static isPresetColor(color: string): boolean {
    return TextColor.presetColors.some((c) => c.hex === color);
  }

  get name() {
    return "textColor";
  }

  get schema(): MarkSpec {
    return {
      attrs: {
        color: {
          default: null,
          validate: "string|null",
        },
      },
      parseDOM: [
        {
          tag: "span[data-text-color]",
          getAttrs: (dom) => {
            const color = dom.getAttribute("data-text-color") || "";
            return {
              color: isHexColor(color) ? color : null,
            };
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          "data-text-color": node.attrs.color,
          style: `color: ${node.attrs.color}`,
        },
      ],
    };
  }

  keys({ type }: { type: MarkType }) {
    return {
      "Mod-Shift-k": toggleMark(type),
    };
  }

  toMarkdown() {
    return {
      open: "",
      close: "",
      mixable: true,
      expelEnclosingWhitespace: true,
    };
  }

  parseMarkdown() {
    return { mark: "textColor" };
  }
}
