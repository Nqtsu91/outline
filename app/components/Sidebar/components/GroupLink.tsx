import { observer } from "mobx-react";
import { GroupIcon } from "outline-icons";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Icon from "@shared/components/Icon";
import type Group from "~/models/Group";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import useBoolean from "~/hooks/useBoolean";
import GroupMenu from "~/menus/GroupMenu";
import Folder from "./Folder";
import Relative from "./Relative";
import SharedWithMeLink from "./SharedWithMeLink";
import SidebarContext, { groupSidebarContext } from "./SidebarContext";
import SidebarDisclosureContext, {
  useSidebarDisclosureState,
} from "./SidebarDisclosureContext";
import SidebarLink from "./SidebarLink";

type Props = {
  /** The group to render */
  group: Group;
};

const GroupLink: React.FC<Props> = ({ group }) => {
  const locationSidebarContext = useLocationSidebarContext();
  const sidebarContext = groupSidebarContext(group.id);
  const [expanded, setExpanded] = React.useState(
    locationSidebarContext === sidebarContext
  );
  const [menuOpen, handleMenuOpen, handleMenuClose] = useBoolean();

  const { event: disclosureEvent, onDisclosureClick } =
    useSidebarDisclosureState();

  const handleDisclosureClick = React.useCallback(
    (ev) => {
      ev?.preventDefault();
      setExpanded((e) => {
        const willExpand = !e;
        onDisclosureClick(willExpand, !!ev?.altKey);
        return willExpand;
      });
    },
    [onDisclosureClick]
  );

  React.useEffect(() => {
    if (locationSidebarContext === sidebarContext) {
      setExpanded(true);
    }
  }, [sidebarContext, locationSidebarContext, setExpanded]);

  return (
    <Relative>
      <SidebarLink
        label={<GroupHeading>{group.name}</GroupHeading>}
        icon={
          group.icon ? (
            <Icon
              value={group.icon}
              color={group.color}
              initial={group.name.charAt(0)}
            />
          ) : (
            <GroupIcon />
          )
        }
        expanded={expanded}
        onClick={handleDisclosureClick}
        depth={0}
        menu={
          <GroupMenu
            group={group}
            hideMembers
            onOpen={handleMenuOpen}
            onClose={handleMenuClose}
          />
        }
        $showActions={menuOpen}
      />
      <SidebarContext.Provider value={sidebarContext}>
        <SidebarDisclosureContext.Provider value={disclosureEvent}>
          <Folder expanded={expanded}>
            {group.documentMemberships.map((membership) => (
              <SharedWithMeLink
                key={membership.id}
                membership={membership}
                depth={2}
              />
            ))}
          </Folder>
        </SidebarDisclosureContext.Provider>
      </SidebarContext.Provider>
    </Relative>
  );
};

/**
 * Group names read as section headings: brighter than page links, bold, and
 * slightly larger, flush to the start of the row.
 */
const GroupHeading = styled.span`
  display: block;
  margin-inline-start: 0;
  font-weight: 700;
  font-size: 15px;
  color: ${s("text")};
  letter-spacing: 0.01em;
`;

export default observer(GroupLink);
