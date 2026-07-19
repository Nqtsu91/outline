import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import Icon from "@shared/components/Icon";
import { s } from "@shared/styles";
import { colorPalette } from "@shared/utils/collections";
import { UserPreference } from "@shared/types";
import type { NavigationNode } from "@shared/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import { DocumentValidation } from "@shared/validations";
import type Collection from "~/models/Collection";
import type Document from "~/models/Document";
import type { RefHandle } from "~/components/EditableTitle";
import EditableTitle from "~/components/EditableTitle";
import useBoolean from "~/hooks/useBoolean";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import DocumentMenu from "~/menus/DocumentMenu";
import { documentEditPath } from "~/utils/routeHelpers";
import lazyWithRetry from "~/utils/lazyWithRetry";

const IconPicker = lazyWithRetry(() => import("~/components/IconPicker"));
import {
  useDragDocument,
  useDropToReorderDocument,
  useDropToReparentDocument,
} from "../hooks/useDragAndDrop";
import { useSidebarExpansion } from "./SidebarExpansionContext";
import Disclosure from "./Disclosure";
import DocumentLink from "./DocumentLink";
import DropCursor from "./DropCursor";
import Folder from "./Folder";
import { useSidebarContext } from "./SidebarContext";

type Props = {
  node: NavigationNode;
  collection?: Collection;
  activeDocument: Document | null | undefined;
  prefetchDocument?: (documentId: string) => Promise<Document | void>;
  depth: number;
  index: number;
  parentId?: string;
};

const PageGroupLink = observer(function PageGroupLinkInner({
  node,
  collection,
  activeDocument,
  prefetchDocument,
  depth,
  index,
  parentId,
}: Props) {
  const { documents } = useStores();
  const { t } = useTranslation();
  const history = useHistory();
  const can = usePolicy(node.id);
  const user = useCurrentUser();
  const document = documents.get(node.id);
  const expansion = useSidebarExpansion();
  const sidebarContext = useSidebarContext();
  const expanded = expansion.isExpanded(node.id);
  const editableTitleRef = React.useRef<RefHandle>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [isMenuOpen, setIsMenuOpen, closeMenu] = useBoolean();
  const [isAddingNewChild, setIsAddingNewChild, closeAddingNewChild] =
    useBoolean();
  const newChildTitleRef = React.useRef<RefHandle>(null);

  const hasChildren =
    node.children.length > 0 ||
    activeDocument?.parentDocumentId === node.id;

  React.useEffect(() => {
    if (!document && node.id) {
      void documents.fetch(node.id);
    }
  }, [documents, document, node.id]);

  React.useEffect(() => {
    if (expanded && node.children.length > 0) {
      void documents.fetchChildDocuments(node.id);
    }
  }, [expanded, documents, node.id, node.children.length]);

  const handleDisclosureClick = React.useCallback(() => {
    if (expanded) {
      expansion.collapse(node.id);
    } else {
      expansion.expand(node.id);
    }
  }, [expansion, expanded, node.id]);

  const handleExpand = React.useCallback(() => {
    expansion.expand(node.id);
  }, [expansion, node.id]);

  const handleTitleChange = React.useCallback(
    async (value: string) => {
      if (!document) {
        return;
      }
      await documents.update({ id: document.id, title: value });
    },
    [documents, document]
  );

  const handleIconChange = React.useCallback(
    async (newIcon: string | null, newColor: string | null) => {
      if (!document) {
        return;
      }
      await documents.update({
        id: document.id,
        icon: newIcon,
        color: newColor,
      });
    },
    [documents, document]
  );

  const handleNewDoc = React.useCallback(
    async (input: string) => {
      const newDocument = await documents.create(
        {
          collectionId: collection?.id,
          parentDocumentId: node.id,
          fullWidth:
            document?.fullWidth ??
            user.getPreference(UserPreference.FullWidthDocuments),
          title: input,
          data: ProsemirrorHelper.getEmptyDocument(),
        },
        { publish: true }
      );
      collection?.addDocument(newDocument, node.id);
      handleExpand();
      history.push({
        pathname: documentEditPath(newDocument),
        state: { sidebarContext },
      });
    },
    [documents, collection, sidebarContext, user, node.id, document, history, handleExpand]
  );

  const handleRename = React.useCallback(() => {
    setIsEditing(true);
  }, [setIsEditing]);

  const handleAddChild = React.useCallback(
    (ev: React.MouseEvent<HTMLButtonElement>) => {
      ev.preventDefault();
      setIsAddingNewChild();
      handleExpand();
    },
    [setIsAddingNewChild, handleExpand]
  );

  const handleNewChildSubmit = React.useCallback(
    async (value: string) => {
      try {
        newChildTitleRef.current?.setIsEditing(false);
        await handleNewDoc(value);
        closeAddingNewChild();
      } catch (_err) {
        newChildTitleRef.current?.setIsEditing(true);
      }
    },
    [handleNewDoc, closeAddingNewChild]
  );

  const parentRef = React.useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag] = useDragDocument(node, depth, document, isEditing);

  const [{ isOverReparent, canDropToReparent }, dropToReparent] =
    useDropToReparentDocument(node, handleExpand, parentRef);

  const [{ isOverReorder: isOverReorderAbove }, dropToReorderAbove] =
    useDropToReorderDocument(node, collection, (item) => {
      if (!collection) {
        return;
      }
      return {
        documentId: item.id,
        collectionId: collection.id,
        parentDocumentId: parentId,
        index,
      };
    });

  const [{ isOverReorder, isDraggingAnyDocument }, dropToReorder] =
    useDropToReorderDocument(node, collection, (item) => {
      if (!collection) {
        return;
      }
      if (expansion.isExpanded(node.id)) {
        return {
          documentId: item.id,
          collectionId: collection.id,
          parentDocumentId: node.id,
          index: 0,
        };
      }
      return {
        documentId: item.id,
        collectionId: collection.id,
        parentDocumentId: parentId,
        index: index + 1,
      };
    });

  const cursorBefore =
    isDraggingAnyDocument && collection?.isManualSort && index === 0 ? (
      <DropCursor
        isActiveDrop={isOverReorderAbove}
        innerRef={dropToReorderAbove}
        position="top"
      />
    ) : undefined;

  const cursorAfter =
    isDraggingAnyDocument && collection?.isManualSort ? (
      <DropCursor isActiveDrop={isOverReorder} innerRef={dropToReorder} />
    ) : undefined;

  const groupIcon = document?.icon ?? node.icon ?? null;
  const groupColor =
    document?.color ?? node.color ?? (colorPalette[0] as string);
  const groupInitial = (document?.title ?? node.title ?? "G")
    .charAt(0)
    .toUpperCase();
  const groupIconFallback = groupIcon ? (
    <Icon value={groupIcon} initial={groupInitial} color={groupColor} size={20} />
  ) : null;

  return (
    <>
      <GroupRow
        ref={parentRef}
        $isDragging={isDragging}
        $isActiveDrop={isOverReparent && canDropToReparent}
      >
        {cursorBefore}
        <GroupInner
          ref={drag as React.Ref<HTMLDivElement>}
          style={{
            paddingInlineStart: `${Math.max(0, depth - 2) * 16 + 6}px`,
          }}
        >
          <div ref={dropToReparent}>
            <GroupHeader>
              {document &&
                (can.update ? (
                  <GroupIconWrapper>
                    <React.Suspense fallback={groupIconFallback}>
                      <IconPicker
                        icon={groupIcon}
                        color={groupColor}
                        initial={groupInitial}
                        size={20}
                        popoverPosition="bottom-start"
                        onChange={handleIconChange}
                        borderOnHover
                        allowDelete
                      />
                    </React.Suspense>
                  </GroupIconWrapper>
                ) : groupIcon ? (
                  <GroupIconWrapper aria-hidden>
                    {groupIconFallback}
                  </GroupIconWrapper>
                ) : null)}
              <GroupLabel onDoubleClick={() => can.update && setIsEditing(true)}>
                <EditableTitle
                  title={document?.title ?? node.title ?? t("New Group")}
                  onSubmit={handleTitleChange}
                  isEditing={isEditing}
                  onEditing={setIsEditing}
                  canUpdate={!!can.update}
                  maxLength={DocumentValidation.maxTitleLength}
                  ref={editableTitleRef}
                />
              </GroupLabel>
              <GroupControls>
                {!isEditing && !isDragging && can.createChildDocument && (
                  <AddButton
                    onClick={handleAddChild}
                    title={t("New page in group")}
                  >
                    +
                  </AddButton>
                )}
                {!isEditing && !isDragging && document && (
                  <MenuWrapper $menuOpen={isMenuOpen}>
                    <DocumentMenu
                      document={document}
                      onRename={handleRename}
                      onOpen={setIsMenuOpen}
                      onClose={closeMenu}
                    />
                  </MenuWrapper>
                )}
                {(hasChildren || isAddingNewChild) && (
                  <RightDisclosure
                    expanded={expanded}
                    onClick={handleDisclosureClick}
                  />
                )}
              </GroupControls>
            </GroupHeader>
          </div>
        </GroupInner>
        {cursorAfter}
      </GroupRow>
      <Folder expanded={expanded && !isDragging}>
        {node.children.map((childNode, childIndex) => (
          <DocumentLink
            key={childNode.id}
            collection={collection}
            node={childNode}
            activeDocument={activeDocument}
            prefetchDocument={prefetchDocument}
            isDraft={childNode.isDraft}
            depth={depth + 1}
            index={childIndex}
            parentId={node.id}
          />
        ))}
        {isAddingNewChild && (
          <EditableTitle
            title=""
            canUpdate
            isEditing
            placeholder={`${t("New page")}…`}
            onCancel={closeAddingNewChild}
            onSubmit={handleNewChildSubmit}
            maxLength={DocumentValidation.maxTitleLength}
            ref={newChildTitleRef}
          />
        )}
      </Folder>
    </>
  );
});

const GroupRow = styled.div<{ $isDragging?: boolean; $isActiveDrop?: boolean }>`
  position: relative;
  margin-top: 16px;
  opacity: ${(p) => (p.$isDragging ? 0.1 : 1)};
  border-radius: 4px;
  background: ${(p) =>
    p.$isActiveDrop ? p.theme.sidebarActiveBackground : "transparent"};
`;

const GroupInner = styled.div`
  display: flex;
  flex-direction: column;
`;

const GroupHeader = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  height: 28px;
  padding-inline-end: 8px;
  gap: 2px;
  cursor: pointer;
  &:hover > button {
    opacity: 1;
  }
`;

// Right-aligned cluster holding the add-page button, overflow menu and the
// expand chevron in a single row so they never overlap.
const GroupControls = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
`;

// The expand/collapse chevron, at the right edge of the row so the icon and
// title stay flush to the start (GitBook-style).
const RightDisclosure = styled(Disclosure)`
  position: static;
  inset-inline-start: auto;
  margin: 0;
  flex-shrink: 0;
  opacity: 0.5;

  &:hover {
    opacity: 1;
  }
`;

const GroupIconWrapper = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-inline-end: 2px;
`;

const GroupLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
`;

const MenuWrapper = styled.div<{ $menuOpen?: boolean }>`
  flex-shrink: 0;
  opacity: ${(p) => (p.$menuOpen ? 1 : 0)};
  transition: opacity 100ms ease;

  ${GroupHeader}:hover & {
    opacity: 1;
  }
`;

const AddButton = styled.button`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: ${s("textTertiary")};
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 100ms ease;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;

  ${GroupHeader}:hover & {
    opacity: 1;
  }

  &:hover {
    background: ${s("sidebarActiveBackground")};
    color: ${s("text")};
    opacity: 1;
  }
`;

export default PageGroupLink;
