import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Icon from "@shared/components/Icon";
import { s } from "@shared/styles";
import type { NavigationNode } from "@shared/types";
import { NavigationNodeType } from "@shared/types";
import type Collection from "~/models/Collection";
import type Document from "~/models/Document";
import useStores from "~/hooks/useStores";
import { sharedModelPath } from "~/utils/routeHelpers";
import Disclosure from "./Disclosure";
import SidebarHoverImagePreview from "./SidebarHoverImagePreview";
import { useSidebarExpansion } from "./SidebarExpansionContext";
import SidebarLink from "./SidebarLink";

type Props = {
  node: NavigationNode;
  collection?: Collection;
  activeDocumentId?: string;
  activeDocument?: Document;
  prefetchDocument?: (documentId: string) => Promise<Document | void>;
  isDraft?: boolean;
  depth: number;
  index: number;
  shareId: string;
  parentId?: string;
};

function DocumentLink(
  {
    node,
    collection,
    activeDocument,
    activeDocumentId,
    prefetchDocument,
    isDraft,
    depth,
    shareId,
  }: Props,
  ref: React.RefObject<HTMLAnchorElement>
) {
  const { documents } = useStores();
  const { t } = useTranslation();
  const expansion = useSidebarExpansion();

  const isActiveDocument = activeDocumentId === node.id;

  const hasChildDocuments =
    !!node.children.length || activeDocument?.parentDocumentId === node.id;
  const document = documents.get(node.id);

  // Auto-expand top-level nodes (depth <= 1) on initial render
  React.useEffect(() => {
    if (hasChildDocuments && depth <= 1 && !expansion.isExpanded(node.id)) {
      expansion.expand(node.id);
    }
  }, [expansion, node.id, hasChildDocuments, depth]);

  const expanded = expansion.isExpanded(node.id);

  const handleDisclosureClick = React.useCallback(
    (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (expanded) {
        const altKey = "altKey" in ev && (ev as React.MouseEvent).altKey;
        if (altKey) {
          expansion.collapseDescendants(node);
        } else {
          expansion.collapse(node.id);
        }
      } else {
        const altKey = "altKey" in ev && (ev as React.MouseEvent).altKey;
        if (altKey) {
          expansion.expandDescendants(node);
        } else {
          expansion.expand(node.id);
        }
      }
    },
    [expanded, expansion, node]
  );

  const nodeChildren = React.useMemo(() => {
    if (
      activeDocument?.isDraft &&
      activeDocument?.isActive &&
      activeDocument?.parentDocumentId === node.id
    ) {
      return [activeDocument?.asNavigationNode, ...node.children];
    }

    return node.children;
  }, [
    activeDocument?.isActive,
    activeDocument?.isDraft,
    activeDocument?.parentDocumentId,
    activeDocument?.asNavigationNode,
    node,
  ]);

  const handlePrefetch = React.useCallback(() => {
    void prefetchDocument?.(node.id);
  }, [prefetchDocument, node]);

  const title =
    (activeDocument?.id === node.id ? activeDocument.title : node.title) ||
    t("Untitled");

  const icon = node.icon ?? node.emoji;
  const initial = title ? title.charAt(0).toUpperCase() : "?";

  // Hover-image preview (same as the app sidebar). The value is carried on the
  // navigation node so it works without loading the full document.
  const hoverImage = node.hoverImage ?? document?.hoverImage;
  const [hoverPreview, setHoverPreview] = React.useState<{
    top: number;
    left: number;
    image: string;
  } | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const handleHoverEnter = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!hoverImage) {
        return;
      }
      const el = e.currentTarget;
      hoverTimer.current = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        setHoverPreview({
          top: rect.top,
          left: rect.right + 8,
          image: hoverImage,
        });
      }, 300);
    },
    [hoverImage]
  );
  const handleHoverLeave = React.useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
    }
    setHoverPreview(null);
  }, []);
  React.useEffect(
    () => () => {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
      }
    },
    []
  );

  const renderChildren = () =>
    expanded &&
    nodeChildren.map((childNode, index) => (
      <SharedDocumentLink
        shareId={shareId}
        key={childNode.id}
        collection={collection}
        node={childNode}
        activeDocumentId={activeDocumentId}
        activeDocument={activeDocument}
        prefetchDocument={prefetchDocument}
        isDraft={childNode.isDraft}
        depth={depth + 1}
        index={index}
        parentId={node.id}
      />
    ));

  // Groups are section headers, not pages — render them like the app sidebar:
  // flush, bold, brighter, with spacing above, and no navigation link.
  if (node.type === NavigationNodeType.Group) {
    return (
      <>
        <GroupHeader
          onClick={hasChildDocuments ? handleDisclosureClick : undefined}
        >
          {hasChildDocuments && (
            <GroupDisclosure expanded={expanded} onClick={handleDisclosureClick} />
          )}
          {icon && (
            <Icon value={icon} color={node.color} initial={initial} size={20} />
          )}
          <GroupTitle>{title}</GroupTitle>
        </GroupHeader>
        {renderChildren()}
      </>
    );
  }

  return (
    <>
      <HoverWrap
        onMouseEnter={hoverImage ? handleHoverEnter : undefined}
        onMouseLeave={hoverImage ? handleHoverLeave : undefined}
      >
        <SidebarLink
          to={{
            pathname: sharedModelPath(shareId, node.url),
            state: {
              title: node.title,
            },
          }}
          expanded={hasChildDocuments && depth !== 0 ? expanded : undefined}
          onDisclosureClick={handleDisclosureClick}
          onClickIntent={handlePrefetch}
          icon={
            icon && <Icon value={icon} color={node.color} initial={initial} />
          }
          label={title}
          depth={depth}
          exact={false}
          scrollIntoViewIfNeeded={!document?.isStarred}
          isDraft={isDraft}
          ref={ref}
          isActive={() => !!isActiveDocument}
        />
      </HoverWrap>
      {hoverPreview && (
        <SidebarHoverImagePreview
          image={hoverPreview.image}
          title={title}
          top={hoverPreview.top}
          left={hoverPreview.left}
        />
      )}
      {renderChildren()}
    </>
  );
}

const HoverWrap = styled.div`
  position: relative;
`;

const GroupHeader = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin-top: 16px;
  padding-inline: 4px 8px;
  cursor: pointer;
  user-select: none;
`;

const GroupDisclosure = styled(Disclosure)`
  position: relative;
  inset-inline-start: auto;
  margin: 0;
  flex-shrink: 0;
`;

const GroupTitle = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const SharedDocumentLink = observer(React.forwardRef(DocumentLink));
