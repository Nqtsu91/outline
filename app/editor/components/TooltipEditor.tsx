import { CloseIcon, ReturnIcon } from "outline-icons";
import type { Mark } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Flex from "~/components/Flex";
import useOnClickOutside from "~/hooks/useOnClickOutside";
import { useEditor } from "./EditorContext";
import Input from "./Input";
import ToolbarButton from "./ToolbarButton";
import Tooltip from "./Tooltip";

type Props = {
  /** The existing tooltip mark being edited, if any. */
  mark?: Mark;
  view: EditorView;
  autoFocus?: boolean;
  onSave: () => void;
  onRemove: () => void;
  onEscape: () => void;
  onClickOutside: (ev: MouseEvent | TouchEvent) => void;
  onClickBack: () => void;
};

/**
 * A small floating editor for adding or editing the hover text (tooltip) that
 * is associated with the current text selection.
 */
const TooltipEditor: React.FC<Props> = ({
  mark,
  view,
  autoFocus,
  onSave,
  onRemove,
  onEscape,
  onClickOutside,
  onClickBack,
}) => {
  const { t } = useTranslation();
  const { commands } = useEditor();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialValue: string = mark?.attrs.title ?? "";
  const [value, setValue] = useState(initialValue);

  const trimmed = value.trim();

  const save = React.useCallback(() => {
    if (!trimmed) {
      return;
    }
    if (mark) {
      commands["updateTooltip"]({ title: trimmed });
    } else {
      commands["addTooltip"]({ title: trimmed });
    }
    onSave();
  }, [commands, mark, trimmed, onSave]);

  const remove = React.useCallback(() => {
    commands["removeTooltip"]();
    onRemove();
  }, [commands, onRemove]);

  useOnClickOutside(wrapperRef, (ev) => {
    if (!trimmed) {
      // Nothing entered — if editing an existing tooltip leave it be, otherwise
      // simply close.
      onClickOutside(ev);
      return;
    }
    if (trimmed === initialValue) {
      onClickOutside(ev);
      return;
    }
    save();
  });

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (!trimmed) {
          return remove();
        }
        save();
        return;
      }
      case "Escape": {
        event.preventDefault();
        if (!initialValue) {
          return remove();
        }
        onEscape();
        return;
      }
    }
  };

  const actions = [
    {
      tooltip: t("Remove"),
      icon: <CloseIcon />,
      visible: view.editable && !!mark,
      handler: remove,
    },
    {
      tooltip: t("Formatting controls"),
      icon: <ReturnIcon />,
      visible: view.editable,
      handler: onClickBack,
    },
  ];

  return (
    <div ref={wrapperRef}>
      <InputWrapper>
        <Input
          value={value}
          placeholder={`${t("Enter hover text")}…`}
          onKeyDown={handleKeyDown}
          onChange={(ev: React.ChangeEvent<HTMLInputElement>) =>
            setValue(ev.target.value)
          }
          autoFocus={autoFocus}
          readOnly={!view.editable}
        />
        {actions.map((action, index) =>
          action.visible ? (
            <Tooltip key={index} content={action.tooltip}>
              <ToolbarButton onClick={action.handler}>
                {action.icon}
              </ToolbarButton>
            </Tooltip>
          ) : null
        )}
      </InputWrapper>
    </div>
  );
};

const InputWrapper = styled(Flex)`
  pointer-events: all;
  gap: 6px;
  padding: 6px;
  align-items: center;
`;

export default TooltipEditor;
