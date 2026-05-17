import fractionalIndex from "fractional-index";
import type { Location } from "history";
import { observer } from "mobx-react";
import * as React from "react";
import { useEffect } from "react";
import styled from "styled-components";
import type Collection from "~/models/Collection";
import type Document from "~/models/Document";
import type Star from "~/models/Star";
import type { RefHandle } from "~/components/EditableTitle";
import useBoolean from "~/hooks/useBoolean";
import { useCollectionMenuAction } from "~/hooks/useCollectionMenuAction";
import { useDocumentMenuAction } from "~/hooks/useDocumentMenuAction";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import CollectionMenu from "~/menus/CollectionMenu";
import DocumentMenu from "~/menus/DocumentMenu";
import {
  useDragStar,
  useDropToChangeCollection,
  useDropToCreateStar,
  useDropToReorderStar,
} from "../hooks/useDragAndDrop";
import { useSidebarLabelAndIcon } from "../hooks/useSidebarLabelAndIcon";
import CollectionRow from "./CollectionRow";
import DocumentRow from "./DocumentRow";
import DropCursor from "./DropCursor";
import Relative from "./Relative";
import type { SidebarContextType } from "./SidebarContext";
import SidebarContext, { starredSidebarContext } from "./SidebarContext";

type Props = {
  star: Star;
};

type StarredDocumentLinkProps = {
  star: Star;
  document: Document;
  sidebarContext: SidebarContextType;
  handlePrefetch: () => void;
  icon: React.ReactNode;
  menuOpen: boolean;
  handleMenuOpen: () => void;
  handleMenuClose: () => void;
  cursor: React.ReactNode;
};

type StarredCollectionLinkProps = {
  star: Star;
  collection: Collection;
  sidebarContext: SidebarContextType;
  cursor: React.ReactNode;
  isDraggingAnyStar: boolean;
};

const StarredDocumentLink = observer(function StarredDocumentLink({
  star,
  document,
  sidebarContext,
  handlePrefetch,
  icon,
  menuOpen,
  handleMenuOpen,
  handleMenuClose,
  cursor,
}: StarredDocumentLinkProps) {
  const { documents } = useStores();
  const can = usePolicy(document);
  const editableTitleRef = React.useRef<RefHandle>(null);
  const [{ isDragging }, draggableRef] = useDragStar(star);

  const handleRename = React.useCallback(() => {
    editableTitleRef.current?.setIsEditing(true);
  }, []);

  const handleTitleChange = React.useCallback(
    async (value: string) => {
      if (!document) {
        return;
      }
      await documents.update({
        id: document.id,
        title: value,
      });
    },
    [documents, document]
  );

  const contextMenuAction = useDocumentMenuAction({
    documentId: document.id,
    onRename: handleRename,
  });

  const isActive = React.useCallback(
    (match, location: Location<{ sidebarContext?: SidebarContextType }>) => {
      if (location.state?.sidebarContext !== sidebarContext) {
        return false;
      }
      return (
        !!match || (!!document && location.pathname.endsWith(document.urlId))
      );
    },
    [sidebarContext, document]
  );

  const menu = (
    <DocumentMenu
      document={document}
      onRename={handleRename}
      onOpen={handleMenuOpen}
      onClose={handleMenuClose}
    />
  );

  return (
    <Draggable ref={draggableRef} $isDragging={isDragging}>
      <DocumentRow
        documentId={document.id}
        document={document}
        to={{ pathname: document.path, state: { sidebarContext } }}
        depth={0}
        icon={icon}
        canEdit={can.update}
        labelText={document.titleWithDefault}
        onTitleChange={handleTitleChange}
        editableTitleRef={editableTitleRef}
        expanded={false}
        hasChildren={false}
        onDisclosureClick={() => undefined}
        isDragging={isDragging}
        menu={menu}
        menuOpen={menuOpen}
        contextAction={contextMenuAction}
        isActiveOverride={isActive}
        onClickIntent={handlePrefetch}
      >
        <Relative>{cursor}</Relative>
      </DocumentRow>
    </Draggable>
  );
});

const StarredCollectionLink = observer(function StarredCollectionLink({
  star,
  collection,
  sidebarContext,
  cursor,
  isDraggingAnyStar,
}: StarredCollectionLinkProps) {
  const can = usePolicy(collection.id);
  const [menuOpen, handleMenuOpen, handleMenuClose] = useBoolean();
  const editableTitleRef = React.useRef<RefHandle>(null);
  const [{ isDragging }, draggableRef] = useDragStar(star);

  const handleTitleChange = React.useCallback(
    async (name: string) => {
      await collection.save({ name });
    },
    [collection]
  );

  const noopExpand = React.useCallback(() => undefined, []);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const [{ isOver, canDrop }, dropRef] = useDropToChangeCollection(
    collection,
    noopExpand,
    parentRef
  );

  const handleRename = React.useCallback(() => {
    editableTitleRef.current?.setIsEditing(true);
  }, []);

  const handlePrefetch = React.useCallback(() => {
    void collection.fetchDocuments();
  }, [collection]);

  const contextMenuAction = useCollectionMenuAction({
    collectionId: collection.id,
    onRename: handleRename,
  });

  const menu = !isDraggingAnyStar ? (
    <CollectionMenu
      collection={collection}
      onRename={handleRename}
      onOpen={handleMenuOpen}
      onClose={handleMenuClose}
    />
  ) : undefined;

  return (
    <SidebarContext.Provider value={sidebarContext}>
      <Draggable ref={draggableRef} $isDragging={isDragging}>
        <CollectionRow
          collection={collection}
          to={{ pathname: collection.path, state: { sidebarContext } }}
          expanded={undefined}
          onDisclosureClick={() => undefined}
          onClickIntent={handlePrefetch}
          canEdit={can.update}
          labelText={collection.name}
          onTitleChange={handleTitleChange}
          editableTitleRef={editableTitleRef}
          contextAction={contextMenuAction}
          menu={menu}
          menuOpen={menuOpen}
          parentRef={parentRef}
          dropRef={dropRef}
          isActiveDropTarget={isOver && canDrop}
        />
      </Draggable>
      <Relative>{cursor}</Relative>
    </SidebarContext.Provider>
  );
});

function StarredLink({ star }: Props) {
  const { collections, documents } = useStores();
  const [menuOpen, handleMenuOpen, handleMenuClose] = useBoolean();
  const { documentId, collectionId } = star;
  const collection = collectionId ? collections.get(collectionId) : undefined;
  const document = documentId ? documents.get(documentId) : undefined;
  const sidebarContext = starredSidebarContext(
    star.documentId ?? star.collectionId ?? ""
  );

  useEffect(() => {
    if (documentId) {
      void documents.fetch(documentId);
    }
  }, [documentId, documents]);

  const handlePrefetch = React.useCallback(() => {
    if (documentId) {
      void documents.prefetchDocument(documentId);
      const doc = documents.get(documentId);
      const documentCollection = doc?.collectionId
        ? collections.get(doc.collectionId)
        : undefined;
      void documentCollection?.fetchDocuments();
    }
  }, [documents, documentId, collections]);

  const getIndex = () => {
    const next = star?.next();
    return fractionalIndex(star?.index || null, next?.index || null);
  };
  const { icon } = useSidebarLabelAndIcon(star);
  const [reorderStarProps, dropToReorderRef] = useDropToReorderStar(getIndex);
  const [createStarProps, dropToStarRef] = useDropToCreateStar(getIndex);

  const cursor = (
    <>
      {reorderStarProps.isDragging && (
        <DropCursor
          isActiveDrop={reorderStarProps.isOverCursor}
          innerRef={dropToReorderRef}
        />
      )}
      {createStarProps.isDragging && (
        <DropCursor
          isActiveDrop={createStarProps.isOverCursor}
          innerRef={dropToStarRef}
        />
      )}
    </>
  );

  if (document) {
    return (
      <StarredDocumentLink
        star={star}
        document={document}
        sidebarContext={sidebarContext}
        handlePrefetch={handlePrefetch}
        icon={icon}
        menuOpen={menuOpen}
        handleMenuOpen={handleMenuOpen}
        handleMenuClose={handleMenuClose}
        cursor={cursor}
      />
    );
  }

  if (collection) {
    return (
      <StarredCollectionLink
        star={star}
        collection={collection}
        sidebarContext={sidebarContext}
        cursor={cursor}
        isDraggingAnyStar={reorderStarProps.isDragging}
      />
    );
  }

  return null;
}

const Draggable = styled.div<{ $isDragging?: boolean }>`
  position: relative;
  transition: opacity 250ms ease;
  opacity: ${(props) => (props.$isDragging ? 0.1 : 1)};
`;

export default observer(StarredLink);
