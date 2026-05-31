import { GroupIcon } from "outline-icons";
import { useTheme } from "styled-components";
import Squircle from "@shared/components/Squircle";
import Icon from "@shared/components/Icon";
import type Group from "~/models/Group";
import { AvatarSize } from "../Avatar/Avatar";

type Props = {
  /** The group to show an avatar for */
  group: Group;
  /** The size of the icon, 24px is default to match standard avatars */
  size?: number;
  /** The color of the avatar */
  color?: string;
  /** The background color of the avatar */
  backgroundColor?: string;
  className?: string;
};

export function GroupAvatar({
  group,
  color,
  backgroundColor,
  size = AvatarSize.Medium,
  className,
}: Props) {
  const theme = useTheme();

  if (group?.icon) {
    return (
      <Squircle color={group.color ?? color ?? theme.text} size={size} className={className}>
        <Icon
          value={group.icon}
          color={backgroundColor ?? theme.background}
          initial={group.name.charAt(0)}
          size={size * 0.75}
        />
      </Squircle>
    );
  }

  return (
    <Squircle color={color ?? theme.text} size={size} className={className}>
      <GroupIcon
        data-fixed-color
        color={backgroundColor ?? theme.background}
        size={size * 0.75}
      />
    </Squircle>
  );
}
