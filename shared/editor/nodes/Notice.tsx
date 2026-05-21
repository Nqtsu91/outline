import type Token from "markdown-it/lib/token.mjs";
import { WarningIcon, InfoIcon, StarredIcon, DoneIcon } from "outline-icons";
import { wrappingInputRule } from "prosemirror-inputrules";
import type {
  NodeSpec,
  Node as ProsemirrorNode,
  NodeType,
} from "prosemirror-model";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import * as React from "react";
import ReactDOM from "react-dom";
import type { Primitive } from "utility-types";
import toggleWrap from "../commands/toggleWrap";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import noticesRule from "../rules/notices";
import Node from "./Node";

export enum NoticeTypes {
  Info = "info",
  Success = "success",
  Tip = "tip",
  Warning = "warning",
  Custom = "custom",
}

/** Convert a hex color (#RRGGBB) to rgba(r,g,b,alpha). */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default class Notice extends Node {
  get name() {
    return "container_notice";
  }

  get rulePlugins() {
    return [noticesRule];
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        style: {
          default: NoticeTypes.Info,
        },
        /** Hex color used only for the Custom notice type. */
        color: {
          default: "#7C3AED",
        },
        /** Emoji icon used only for the Custom notice type. */
        icon: {
          default: "💡",
        },
      },
      content:
        "(list | blockquote | hr | paragraph | heading | code_block | code_fence | attachment)+",
      group: "block",
      defining: true,
      draggable: true,
      parseDOM: [
        // Custom notice — must come before the generic rule
        {
          tag: "div.notice-block.custom",
          preserveWhitespace: "full",
          contentElement: (node: HTMLDivElement) =>
            node.querySelector("div.content") || node,
          getAttrs: (dom: HTMLDivElement) => ({
            style: NoticeTypes.Custom,
            color: dom.dataset.color || "#7C3AED",
            icon: dom.dataset.icon || "💡",
          }),
        },
        {
          tag: "div.notice-block",
          preserveWhitespace: "full",
          contentElement: (node: HTMLDivElement) =>
            node.querySelector("div.content") || node,
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes(NoticeTypes.Tip)
              ? NoticeTypes.Tip
              : dom.className.includes(NoticeTypes.Warning)
                ? NoticeTypes.Warning
                : dom.className.includes(NoticeTypes.Success)
                  ? NoticeTypes.Success
                  : undefined,
          }),
        },
        // Quill editor parsing
        {
          tag: "div.ql-hint",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.dataset.hint,
          }),
        },
        // GitBook parsing
        {
          tag: "div.alert.theme-admonition",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes(NoticeTypes.Warning)
              ? NoticeTypes.Warning
              : dom.className.includes(NoticeTypes.Success)
                ? NoticeTypes.Success
                : undefined,
          }),
        },
        // Confluence parsing
        {
          tag: "div.confluence-information-macro",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLDivElement) => ({
            style: dom.className.includes("confluence-information-macro-tip")
              ? NoticeTypes.Success
              : dom.className.includes("confluence-information-macro-note")
                ? NoticeTypes.Tip
                : dom.className.includes("confluence-information-macro-warning")
                  ? NoticeTypes.Warning
                  : undefined,
          }),
        },
      ],
      toDOM: (node) => {
        let icon: HTMLDivElement | undefined;

        // ── Custom notice ─────────────────────────────────────────────
        if (node.attrs.style === NoticeTypes.Custom) {
          const color: string = node.attrs.color || "#7C3AED";
          const emoji: string = node.attrs.icon || "💡";

          if (typeof document !== "undefined") {
            icon = document.createElement("div");
            icon.className = "icon";
            icon.style.fontSize = "18px";
            icon.style.lineHeight = "24px";
            icon.style.textAlign = "center";
            icon.textContent = emoji;
          }

          return [
            "div",
            {
              class: "notice-block custom",
              style: `background:${hexToRgba(color, 0.1)};border-left:4px solid ${color};`,
              "data-color": color,
              "data-icon": emoji,
            },
            ...(icon ? [icon] : []),
            ["div", { class: "content" }, 0],
          ];
        }

        // ── Standard notice types ──────────────────────────────────────
        if (typeof document !== "undefined") {
          let component;

          if (node.attrs.style === NoticeTypes.Tip) {
            component = <StarredIcon />;
          } else if (node.attrs.style === NoticeTypes.Warning) {
            component = <WarningIcon />;
          } else if (node.attrs.style === NoticeTypes.Success) {
            component = <DoneIcon />;
          } else {
            component = <InfoIcon />;
          }

          icon = document.createElement("div");
          icon.className = "icon";
          ReactDOM.render(component, icon);
        }

        return [
          "div",
          { class: `notice-block ${node.attrs.style}` },
          ...(icon ? [icon] : []),
          ["div", { class: "content" }, 0],
        ];
      },
    };
  }

  commands({ type }: { type: NodeType }) {
    return {
      container_notice: (attrs: Record<string, Primitive>) =>
        toggleWrap(type, attrs),
      info: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Info),
      warning: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Warning),
      success: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Success),
      tip: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Tip),
      custom: (): Command => (state, dispatch) =>
        this.handleStyleChange(state, dispatch, NoticeTypes.Custom),
      setNoticeColor: (attrs: { color: string }): Command => (state, dispatch) =>
        this.handleAttrChange(state, dispatch, { color: attrs.color }),
      setNoticeIcon: (attrs: { icon: string }): Command => (state, dispatch) =>
        this.handleAttrChange(state, dispatch, { icon: attrs.icon }),
    };
  }

  handleStyleChange = (
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    style: NoticeTypes
  ): boolean => {
    const { tr, selection } = state;
    const { $from } = selection;
    const node = $from.node(-1);

    if (node?.type.name === this.name) {
      if (dispatch) {
        const transaction = tr.setNodeMarkup($from.before(-1), undefined, {
          ...node.attrs,
          style,
        });
        dispatch(transaction);
      }
      return true;
    }
    return false;
  };

  handleAttrChange = (
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    updates: Record<string, Primitive>
  ): boolean => {
    const { tr, selection } = state;
    const { $from } = selection;
    const node = $from.node(-1);

    if (node?.type.name === this.name) {
      if (dispatch) {
        dispatch(
          tr.setNodeMarkup($from.before(-1), undefined, {
            ...node.attrs,
            ...updates,
          })
        );
      }
      return true;
    }
    return false;
  };

  inputRules({ type }: { type: NodeType }) {
    return [wrappingInputRule(/^:::$/, type)];
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    if (node.attrs.style === NoticeTypes.Custom) {
      const color: string = node.attrs.color || "#7C3AED";
      const icon: string = node.attrs.icon || "💡";
      state.write(`\n:::custom|${color}|${icon}\n`);
    } else {
      state.write("\n:::" + (node.attrs.style || "info") + "\n");
    }
    state.renderContent(node);
    state.ensureNewLine();
    state.write(":::");
    state.closeBlock(node);
  }

  parseMarkdown() {
    return {
      block: "container_notice",
      getAttrs: (tok: Token) => {
        const info = tok.info.trim();
        if (info === NoticeTypes.Custom || info.startsWith("custom|")) {
          const parts = info.split("|");
          return {
            style: NoticeTypes.Custom,
            color: parts[1] || "#7C3AED",
            icon: parts[2] || "💡",
          };
        }
        return { style: info };
      },
    };
  }
}
