import fractionalIndex from "fractional-index";
import { observer } from "mobx-react";
import { useEffect, useMemo } from "react";
import { useDrop } from "react-dnd";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type Collection from "~/models/Collection";
import Flex from "~/components/Flex";
import Error from "~/components/List/Error";
import PaginatedList from "~/components/PaginatedList";
import { createCollection, createCollectionFolder } from "~/actions/definitions/collections";
import useStores from "~/hooks/useStores";
import type { DragObject } from "../hooks/useDragAndDrop";
import CollectionFolderLink from "./CollectionFolderLink";
import DraggableCollectionLink from "./DraggableCollectionLink";
import DropCursor from "./DropCursor";
import Header from "./Header";
import PlaceholderCollections from "./PlaceholderCollections";
import Relative from "./Relative";
import SidebarAction from "./SidebarAction";
import SidebarContext from "./SidebarContext";
import SidebarLink from "./SidebarLink";
import Text from "@shared/components/Text";
import usePolicy from "~/hooks/usePolicy";

type Props = {
  onCollectionOpen?: () => void;
};

function Collections({ onCollectionOpen }: Props) {
  const { documents, auth, collections, collectionFolders } = useStores();
  const { t } = useTranslation();
  const can = usePolicy(auth.team?.id);
  const orderedCollections = collections.allActive;

  useEffect(() => {
    void collectionFolders.fetchAll();
  }, [collectionFolders]);

  // Collections that do not belong to any folder.
  // Intentionally NOT memoized — MobX observer must access c.folderId
  // on every render so it re-renders reactively when a folderId changes.
  const ungroupedCollections = orderedCollections.filter((c) => !c.folderId);

  // Returns collections belonging to a specific folder
  const collectionsByFolder = (folderId: string) =>
    orderedCollections.filter((c) => c.folderId === folderId);

  const params = useMemo(
    () => ({
      limit: 100,
    }),
    []
  );

  const [
    { isCollectionDropping, isDraggingAnyCollection },
    dropToReorderCollection,
  ] = useDrop({
    accept: "collection",
    drop: async (item: DragObject) => {
      void collections.move(
        item.id,
        fractionalIndex(null, orderedCollections[0].index)
      );
    },
    canDrop: (item) => item.id !== orderedCollections[0].id,
    collect: (monitor) => ({
      isCollectionDropping: monitor.isOver(),
      isDraggingAnyCollection: monitor.getItemType() === "collection",
    }),
  });

  return (
    <SidebarContext.Provider value="collections">
      <Flex column>
        <Header id="collections" title={t("Collections")}>
          <Relative>
            {collectionFolders.orderedData.map((folder) => (
              <CollectionFolderLink
                key={folder.id}
                folder={folder}
                collections={collectionsByFolder(folder.id)}
                activeDocument={documents.active}
                onCollectionOpen={onCollectionOpen}
              />
            ))}
            <PaginatedList<Collection>
              options={params}
              aria-label={t("Collections")}
              items={ungroupedCollections}
              loading={<PlaceholderCollections />}
              heading={
                isDraggingAnyCollection ? (
                  <DropCursor
                    isActiveDrop={isCollectionDropping}
                    innerRef={dropToReorderCollection}
                    position="top"
                  />
                ) : undefined
              }
              empty={
                // No need for empty state if we're displaying the createCollection action
                can.createCollection ? null : (
                  <SidebarLink
                    label={
                      <Text type="tertiary" size="small" italic>
                        {t("No collections")}
                      </Text>
                    }
                    onClick={() => {}}
                    depth={1.5}
                  />
                )
              }
              renderError={(props) => <StyledError {...props} />}
              renderItem={(item, index) => (
                <DraggableCollectionLink
                  key={item.id}
                  collection={item}
                  activeDocument={documents.active}
                  belowCollection={ungroupedCollections[index + 1]}
                  onOpen={onCollectionOpen}
                />
              )}
            />
            <SidebarAction action={createCollection} depth={0} />
            <SidebarAction action={createCollectionFolder} depth={0} />
          </Relative>
        </Header>
      </Flex>
    </SidebarContext.Provider>
  );
}

export const StyledError = styled(Error)`
  font-size: 15px;
  padding: 0 8px;
`;

export default observer(Collections);
