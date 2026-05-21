import type { TFunction } from "i18next";
import * as React from "react";
import styled from "styled-components";
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
import { useEditor } from "~/editor/components/EditorContext";

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

// ── Color swatch (toolbar trigger icon) ──────────────────────────────────────

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        background: color,
        border: "1.5px solid rgba(0,0,0,0.12)",
        boxSizing: "border-box",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
  );
}

// ── Full color picker (renders inside the dropdown as custom content) ─────────

function NoticeColorPickerContent({ currentColor }: { currentColor: string }) {
  const { commands } = useEditor();

  const handleSwatchClick = React.useCallback(
    (color: string) => {
      commands.setNoticeColor({ color });
    },
    [commands]
  );

  const handleNativeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      commands.setNoticeColor({ color: e.target.value });
    },
    [commands]
  );

  return (
    <PickerWrapper>
      <SwatchGrid>
        {NOTICE_COLORS.map(({ color, label }) => (
          <SwatchButton
            key={color}
            title={label}
            $color={color}
            $selected={currentColor.toLowerCase() === color.toLowerCase()}
            onClick={() => handleSwatchClick(color)}
          />
        ))}
      </SwatchGrid>
      <NativeRow>
        <NativeColorInput
          type="color"
          value={currentColor}
          onChange={handleNativeChange}
          title="Custom color"
        />
        <HexLabel>{currentColor.toUpperCase()}</HexLabel>
      </NativeRow>
    </PickerWrapper>
  );
}

// ── Emoji picker (renders inside the dropdown as custom content) ──────────────

function NoticeEmojiPickerContent({ currentIcon }: { currentIcon: string }) {
  const { commands } = useEditor();

  const handleEmojiClick = React.useCallback(
    (icon: string) => {
      commands.setNoticeIcon({ icon });
    },
    [commands]
  );

  return (
    <EmojiGrid>
      {NOTICE_EMOJIS.map((emoji) => (
        <EmojiButton
          key={emoji}
          $selected={currentIcon === emoji}
          onClick={() => handleEmojiClick(emoji)}
          title={emoji}
        >
          {emoji}
        </EmojiButton>
      ))}
    </EmojiGrid>
  );
}

// ── Styled components ─────────────────────────────────────────────────────────

const PickerWrapper = styled.div`
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SwatchGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
`;

const SwatchButton = styled.button<{ $color: string; $selected: boolean }>`
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  border: ${(p) =>
    p.$selected
      ? "2px solid white"
      : "1.5px solid rgba(0,0,0,0.12)"};
  box-shadow: ${(p) =>
    p.$selected ? `0 0 0 2px ${p.$color}` : "none"};
  cursor: pointer;
  padding: 0;
  transition: transform 80ms ease;
  &:hover {
    transform: scale(1.15);
  }
`;

const NativeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding-top: 8px;
`;

const NativeColorInput = styled.input`
  width: 32px;
  height: 26px;
  padding: 1px 2px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  cursor: pointer;
  background: none;
`;

const HexLabel = styled.span`
  font-size: 12px;
  font-family: monospace;
  opacity: 0.6;
  user-select: all;
`;

const EmojiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 6px;
`;

const EmojiButton = styled.button<{ $selected: boolean }>`
  font-size: 18px;
  line-height: 1;
  padding: 5px;
  border-radius: 6px;
  border: none;
  background: ${(p) =>
    p.$selected ? "rgba(0,0,0,0.1)" : "transparent"};
  cursor: pointer;
  transition: background 80ms ease;
  &:hover {
    background: rgba(0, 0, 0, 0.08);
  }
`;

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
      icon: <ColorSwatch color={currentColor} />,
      // Single "content" child renders the full picker inside the dropdown.
      // Preset swatches close the dropdown naturally via Radix; the native
      // <input type="color"> stays open because focus remains on the input.
      children: [
        {
          content: (
            <NoticeColorPickerContent currentColor={currentColor} />
          ),
        },
      ],
    },

    // ── Emoji picker (only when custom) ───────────────────────────────
    {
      name: "setNoticeIcon",
      visible: isCustom && !readOnly,
      tooltip: t("Icon"),
      icon: (
        <span style={{ fontSize: "16px", lineHeight: 1 }}>{currentIcon}</span>
      ),
      children: [
        {
          content: (
            <NoticeEmojiPickerContent currentIcon={currentIcon} />
          ),
        },
      ],
    },
  ];
}
