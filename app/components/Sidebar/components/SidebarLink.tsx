import type { LocationDescriptor } from "history";
import * as React from "react";
import styled, { useTheme, css } from "styled-components";
import breakpoint from "styled-components-breakpoint";
import EventBoundary from "@shared/components/EventBoundary";
import { ellipsis, s } from "@shared/styles";
import { isMobile } from "@shared/utils/browser";
import NudeButton from "~/components/NudeButton";
import { UnreadBadge } from "~/components/UnreadBadge";
import useClickIntent from "~/hooks/useClickIntent";
import { undraggableOnDesktop } from "~/styles";
import Disclosure from "./Disclosure";
import type { Props as NavLinkProps } from "./NavLink";
import NavLink from "./NavLink";
import type { ActionWithChildren } from "~/types";
import { ContextMenu } from "~/components/Menu/ContextMenu";
import { useTranslation } from "react-i18next";

/**
 * Props for the SidebarLink component.
 * Extends NavLink props with additional sidebar-specific functionality.
 */
type Props = Omit<NavLinkProps, "to"> & {
  /** The location to navigate to when the link is clicked */
  to?: LocationDescriptor;
  /** Ref callback to access the underlying HTML element */
  innerRef?: (ref: HTMLElement | null | undefined) => void;
  /** Callback fired when the link is clicked */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  /** Callback when we expect the user to click on the link. Used for prefetching data. */
  onClickIntent?: React.MouseEventHandler<HTMLElement>;
  /** Callback fired when the disclosure icon is clicked */
  onDisclosureClick?: React.MouseEventHandler<HTMLElement>;
  /** Icon to display on the left side of the link */
  icon?: React.ReactNode;
  /** Text label or content to display for the link */
  label?: React.ReactNode;
  /** Optional menu to display on hover or interaction */
  menu?: React.ReactNode;
  /** Whether to show an unread badge indicator */
  unreadBadge?: boolean;
  /** Whether to show action buttons on hover */
  $showActions?: boolean;
  /** Whether the link is disabled and non-interactive */
  disabled?: boolean;
  /** Whether the link is currently active */
  active?: boolean;
  /** If set, a disclosure will be rendered to the left of any icon */
  expanded?: boolean;
  /** Whether this link is the current active drop target for drag and drop */
  isActiveDrop?: boolean;
  /** Whether this link represents a draft document */
  isDraft?: boolean;
  /** Nesting depth level for indentation (0-based) */
  depth?: number;
  /** Whether to truncate the label text (default: true, causes overflow: hidden) */
  ellipsis?: boolean;
  /** Whether to automatically scroll this link into view if needed */
  scrollIntoViewIfNeeded?: boolean;
  /** Optional context menu action to display */
  contextAction?: ActionWithChildren;
};

const activeDropStyle = {
  fontWeight: 600,
};

// Prevents the parent NavLink's mousedown handler from firing (which would
// navigate or toggle), without calling preventDefault — that would block the
// native HTML5 drag from initiating on the draggable row.
const stopPropagation = (ev: React.MouseEvent) => {
  ev.stopPropagation();
};

function SidebarLink(
  {
    icon,
    onClick,
    onClickIntent,
    to,
    label,
    active,
    isActiveDrop,
    isDraft,
    menu,
    $showActions,
    exact,
    href,
    depth,
    className,
    expanded,
    onDisclosureClick,
    disabled,
    unreadBadge,
    contextAction,
    ellipsis = true,
    ...rest
  }: Props,
  ref: React.RefObject<HTMLAnchorElement>
) {
  const hasDisclosure = expanded !== undefined;
  const { t } = useTranslation();
  const theme = useTheme();
  const { handleMouseEnter, handleMouseLeave } = useClickIntent(onClickIntent);
  const style = React.useMemo(
    () => ({
      // Collection children start at depth 2, so treat that as the flush base:
      // top-level pages sit at the start and each nesting level adds 16px.
      // Indentation is icon-independent so a page always sits deeper than its
      // parent regardless of whether either has an icon.
      paddingInlineStart: `${Math.max(0, (depth || 0) - 2) * 16 + 8}px`,
      paddingInlineEnd: unreadBadge
        ? "32px"
        : hasDisclosure
          ? "24px"
          : undefined,
    }),
    [depth, icon, unreadBadge, hasDisclosure]
  );

  const unreadStyle = React.useMemo(
    () => ({
      insetInlineEnd: -20,
    }),
    []
  );

  const activeStyle = React.useMemo(
    () => ({
      color: theme.text,
      background: theme.sidebarActiveBackground,
      ...style,
    }),
    [theme.text, theme.sidebarActiveBackground, style]
  );

  const handleClick = React.useCallback(
    (ev: React.MouseEvent<HTMLAnchorElement>) => {
      if (onClick && !disabled && ev.isDefaultPrevented() === false) {
        onClick(ev);
      }
    },
    [onClick, disabled]
  );

  const handleDisclosureClick = React.useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      if (!hasDisclosure) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      onDisclosureClick?.(ev);
    },
    [onDisclosureClick, hasDisclosure]
  );

  const innerContent = (
    <>
      <ContextMenu action={contextAction} ariaLabel={t("Link options")}>
        <Content>
          {icon && <IconWrapper aria-hidden>{icon}</IconWrapper>}
          <Label $ellipsis={ellipsis}>{label}</Label>
          {unreadBadge && <UnreadBadge style={unreadStyle} />}
        </Content>
      </ContextMenu>
      {(hasDisclosure || menu) && (
        <RightControls>
          {menu && <Actions $showActions={$showActions}>{menu}</Actions>}
          {hasDisclosure && (
            <RightDisclosure
              expanded={expanded}
              onClick={handleDisclosureClick}
              onMouseDown={stopPropagation}
              tabIndex={-1}
            />
          )}
        </RightControls>
      )}
    </>
  );

  if (!to) {
    return (
      <Link
        as={href ? "a" : "button"}
        $isActiveDrop={isActiveDrop}
        $isDraft={isDraft}
        $disabled={disabled}
        style={active ? activeStyle : style}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDragEnter={handleMouseEnter}
        href={href}
        className={className}
        ref={ref}
        {...rest}
      >
        {innerContent}
      </Link>
    );
  }

  return (
    <Link
      $isActiveDrop={isActiveDrop}
      $isDraft={isDraft}
      $disabled={disabled}
      style={active ? activeStyle : style}
      activeStyle={isActiveDrop ? activeDropStyle : activeStyle}
      onClick={handleClick}
      onActiveClick={handleDisclosureClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragEnter={handleMouseEnter}
      exact={exact !== false}
      to={to!}
      href={href}
      className={className}
      // @ts-expect-error spread props cause overload mismatch with styled NavLink
      ref={ref}
      {...rest}
    >
      {innerContent}
    </Link>
  );
}

// accounts for whitespace around icon
export const IconWrapper = styled.span`
  margin-inline-start: -4px;
  height: 24px;
  overflow: hidden;
  flex-shrink: 0;
  transition: opacity 200ms ease-in-out;
`;

const Content = styled.span`
  display: flex;
  align-items: start;
  position: relative;
  width: 100%;
  min-width: 0;
`;

// Right-aligned cluster holding the overflow menu and the expand chevron so
// they lay out in a row and never overlap each other.
const RightControls = styled.span`
  position: absolute;
  inset-inline-end: 4px;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 2px;
`;

const Actions = styled(EventBoundary)<{ $showActions?: boolean }>`
  display: inline-flex;
  align-items: center;
  visibility: ${(props) => (props.$showActions ? "visible" : "hidden")};
  gap: 4px;
  color: ${s("textTertiary")};
  transition: opacity 50ms;
  height: 24px;
  background: var(--background);

  svg {
    color: ${s("textSecondary")};
    fill: currentColor;
    opacity: 0.5;
  }

  &:hover {
    visibility: visible;

    svg {
      opacity: 0.75;
    }
  }
`;

// The expand/collapse chevron, pinned at the end of the row (GitBook-style) so
// nesting doesn't push the icon and label to the right. It sits to the right of
// the overflow menu within RightControls, so the two never overlap.
const RightDisclosure = styled(Disclosure)`
  position: relative;
  inset-inline-start: auto;
  margin: 0;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 100ms ease;

  &:hover {
    opacity: 1;
  }
`;

const Link = styled(NavLink)<{
  $isActiveDrop?: boolean;
  $isDraft?: boolean;
  $disabled?: boolean;
}>`
  &:hover,
  &:active,
  &:has([data-state="open"]) {
    --background: ${s("sidebarHoverBackground")};
  }

  &[aria-current="page"] ${Actions} {
    --background: ${s("sidebarActiveBackground")};
  }

  ${(props) => props.$isActiveDrop && `--background: ${props.theme.slateDark};`}

  display: flex;
  position: relative;
  text-overflow: ellipsis;
  font-weight: 475;
  padding: ${isMobile() ? 12 : 6}px 16px;
  border-radius: 4px;
  min-height: 30px;
  user-select: none;
  white-space: nowrap;
  margin-top: 1px;
  background: var(--background);
  color: ${(props) =>
    props.$isActiveDrop ? props.theme.white : props.theme.sidebarText};
  font-size: 16px;
  cursor: var(--pointer);
  overflow: hidden;
  border: 0;
  width: 100%;
  ${undraggableOnDesktop()}

  ${(props) =>
    props.$disabled &&
    css`
      pointer-events: none;
      opacity: 0.75;
    `}

  ${(props) =>
    props.$isDraft &&
    css`
      &:after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: 4px;
        border: 1.5px dashed ${props.theme.sidebarDraftBorder};
      }
    `}

  svg {
    ${(props) => (props.$isActiveDrop ? `fill: ${props.theme.white};` : "")}
    transition: fill 50ms;
  }

  ${breakpoint("tablet")`
    padding-block: 3px;
    padding-inline: 12px 8px;
    font-size: 14px;
  `}

  @media (hover: hover) {
    &:hover ${Actions}, &:active ${Actions} {
      visibility: visible;

      svg {
        opacity: 0.75;
      }
    }

    &:hover {
      color: ${(props) =>
        props.$isActiveDrop ? props.theme.white : props.theme.text};
    }
  }

  & ${Actions} {
    ${NudeButton} {
      background: transparent;

      &:hover,
      &[aria-expanded="true"] {
        background: ${s("sidebarControlHoverBackground")};
      }
    }
  }
`;

const Label = styled.div<{ $ellipsis: boolean }>`
  position: relative;
  width: 100%;
  line-height: 24px;
  margin-inline-start: 2px;
  min-width: 0;
  text-align: start;

  ${(props) => props.$ellipsis && ellipsis()}

  * {
    unicode-bidi: plaintext;
  }
`;

export default React.forwardRef<HTMLAnchorElement, Props>(SidebarLink);
