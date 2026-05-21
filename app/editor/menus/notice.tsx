import type { TFunction } from "i18next";
import * as React from "react";
import {
  DoneIcon,
  ExpandedIcon,
  InfoIcon,
  StarredIcon,
  WarningIcon,
} from "outline-icons";
import type { EditorState } from "prosemirror-state";
import { NoticeTypes } from "@shared/editor/nodes/Notice";
import type { MenuItem } from "@shared/editor/types";

// ── Color palette ─────────────────────────────────────────────────────────────

const NOTICE_COLORS: Array<{ color: string; label: string }> = [
  { color: "#7C3AED", label: "Violet" },
  { color: "#2563EB", label: "Blue" },
  { color: "#0891B2", label: "Cyan" },
  { color: "#059669", label: "Green" },
  { color: "#D97706", label: "Amber" },
  { color: "#DC2626", label: "Red" },
  { color: "#DB2777", label: "Pink" },
  { color: "#9CA3AF", label: "Gray" },
];

// ── Emoji set ─────────────────────────────────────────────────────────────────

const NOTICE_EMOJIS = [
  "💡", "⭐", "🔥", "✅", "❌", "⚠️",
  "🎯", "📝", "🚀", "💬", "🔔", "🎨",
];

// ── Color swatch component ────────────────────────────────────────────────────

function ColorSwatch({
  color,
  selected,
}: {
  color: string;
  selected: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        background: color,
        border: selected
          ? `2px solid white`
          : "1.5px solid rgba(0,0,0,0.12)",
        boxShadow: selected ? `0 0 0 2px ${color}` : "none",
        boxSizing: "border-box",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
  );
}

// ── Menu builder ──────────────────────────────────────────────────────────────

export default function noticeMenuItems(
  state: EditorState,
  readOnly: boolean | undefined,
  t: TFunction
): MenuItem[] {
  const node = state.selection.$from.node(-1);
  const currentStyle = node?.attrs.style as NoticeTypes;
  const currentColor: string = node?.attrs.color || "#7C3AED";
  const currentIcon: string = node?.attrs.icon || "💡";
  const isCustom = currentStyle === NoticeTypes.Custom;

  const mapping: Record<string, string> = {
    [NoticeTypes.Info]: t("Info notice"),
    [NoticeTypes.Warning]: t("Warning notice"),
    [NoticeTypes.Success]: t("Success notice"),
    [NoticeTypes.Tip]: t("Tip notice"),
    [NoticeTypes.Custom]: t("Custom notice"),
  };

  return [
    // ── Type picker ────────────────────────────────────────────────────
    {
      name: "container_notice",
      visible: !readOnly,
      label: mapping[currentStyle] ?? t("Notice"),
      icon: <ExpandedIcon />,
      children: [
        {
          name: NoticeTypes.Info,
          icon: <InfoIcon />,
          label: t("Info notice"),
          active: () => currentStyle === NoticeTypes.Info,
        },
        {
          name: NoticeTypes.Success,
          icon: <DoneIcon />,
          label: t("Success notice"),
          active: () => currentStyle === NoticeTypes.Success,
        },
        {
          name: NoticeTypes.Warning,
          icon: <WarningIcon />,
          label: t("Warning notice"),
          active: () => currentStyle === NoticeTypes.Warning,
        },
        {
          name: NoticeTypes.Tip,
          icon: <StarredIcon />,
          label: t("Tip notice"),
          active: () => currentStyle === NoticeTypes.Tip,
        },
        {
          name: "separator",
        },
        {
          name: "custom",
          icon: <span style={{ fontSize: "16px" }}>🎨</span>,
          label: t("Custom notice"),
          active: () => isCustom,
        },
      ],
    },

    // ── Color picker (only when custom) ───────────────────────────────
    {
      name: "setNoticeColor",
      visible: isCustom && !readOnly,
      tooltip: t("Color"),
      icon: <ColorSwatch color={currentColor} selected={false} />,
      children: NOTICE_COLORS.map(({ color, label }) => ({
        name: "setNoticeColor",
        attrs: { color },
        icon: <ColorSwatch color={color} selected={currentColor === color} />,
        label,
        active: () => currentColor === color,
      })),
    },

    // ── Emoji picker (only when custom) ───────────────────────────────
    {
      name: "setNoticeIcon",
      visible: isCustom && !readOnly,
      tooltip: t("Icon"),
      icon: (
        <span
          style={{ fontSize: "16px", lineHeight: 1, display: "inline-block" }}
        >
          {currentIcon}
        </span>
      ),
      children: NOTICE_EMOJIS.map((emoji) => ({
        name: "setNoticeIcon",
        attrs: { icon: emoji },
        icon: (
          <span
            style={{
              fontSize: "16px",
              lineHeight: 1,
              display: "inline-block",
            }}
          >
            {emoji}
          </span>
        ),
        label: emoji,
        active: () => currentIcon === emoji,
      })),
    },
  ];
}
