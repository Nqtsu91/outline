import { useMemo } from "react";
import { useMenuAction } from "./useMenuAction";
import { ActionSeparator, createAction, createActionWithChildren } from "~/actions";
import {
  deleteCollection,
  editCollection,
  editCollectionPermissions,
  starCollection,
  unstarCollection,
  searchInCollection,
  createTemplate,
  archiveCollection,
  restoreCollection,
  subscribeCollection,
  unsubscribeCollection,
  createDocument,
  createPageGroup,
  exportCollection,
  importDocument,
  sortCollection,
} from "~/actions/definitions/collections";
import { ActiveCollectionSection } from "~/actions/sections";
import { GroupIcon, InputIcon } from "outline-icons";
import usePolicy from "./usePolicy";
import useStores from "./useStores";
import { useTranslation } from "react-i18next";

type Props = {
  /** Collection ID for which the actions are generated */
  collectionId: string;
  /** Invoked when the "Rename" menu item is clicked */
  onRename?: () => void;
};

export function useCollectionMenuAction({ collectionId, onRename }: Props) {
  const { collections, collectionFolders } = useStores();
  const { t } = useTranslation();
  const collection = collections.get(collectionId);
  const can = usePolicy(collection);

  const moveToFolderAction = useMemo(
    () =>
      createActionWithChildren({
        name: t("Move to folder"),
        section: ActiveCollectionSection,
        icon: <GroupIcon />,
        visible: !!can.update,
        children: () => [
          // "No folder" option if currently in a folder
          ...(collection?.folderId
            ? [
                createAction({
                  name: t("Remove from folder"),
                  section: ActiveCollectionSection,
                  perform: () =>
                    collectionFolders.moveCollection(collection.id, null),
                }),
              ]
            : []),
          // One entry per existing folder
          ...collectionFolders.orderedData
            .filter((f) => f.id !== collection?.folderId)
            .map((folder) =>
              createAction({
                name: folder.name,
                section: ActiveCollectionSection,
                perform: () =>
                  collectionFolders.moveCollection(collection!.id, folder.id),
              })
            ),
        ],
      }),
    [t, can.update, collection, collectionFolders]
  );

  const actions = useMemo(
    () => [
      restoreCollection,
      starCollection,
      unstarCollection,
      subscribeCollection,
      unsubscribeCollection,
      ActionSeparator,
      createDocument,
      createPageGroup,
      importDocument,
      ActionSeparator,
      createAction({
        name: `${t("Rename")}…`,
        section: ActiveCollectionSection,
        icon: <InputIcon />,
        visible: !!can.update && !!onRename,
        perform: () => requestAnimationFrame(() => onRename?.()),
      }),
      editCollection,
      editCollectionPermissions,
      createTemplate,
      sortCollection,
      exportCollection,
      archiveCollection,
      searchInCollection,
      moveToFolderAction,
      ActionSeparator,
      deleteCollection,
    ],
    [t, can.update, onRename, moveToFolderAction]
  );

  return useMenuAction(actions);
}
