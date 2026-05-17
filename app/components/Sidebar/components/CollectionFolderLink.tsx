import { observer } from "mobx-react";
import { GroupIcon, EditIcon, TrashIcon } from "outline-icons";
import * as React from "react";
import { useDrop } from "react-dnd";
import { useTranslation } from "react-i18next";
import type Collection from "~/models/Collection";
import type CollectionFolder from "~/models/CollectionFolder";
import type Document from "~/models/Document";
import Button from "~/components/Button";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Fade from "~/components/Fade";
import Input from "~/components/Input";
import { DropdownMenu } from "~/components/Menu/DropdownMenu";
import { OverflowMenuButton } from "~/components/Menu/OverflowMenuButton";
import useBoolean from "~/hooks/useBoolean";
import { useMenuAction } from "~/hooks/useMenuAction";
import useStores from "~/hooks/useStores";
import { createAction } from "~/actions";
import { GroupSection } from "~/actions/sections";
import DraggableCollectionLink from "./DraggableCollectionLink";
import Folder from "./Folder";
import Relative from "./Relative";
import SidebarLink from "./SidebarLink";

type Props = {
  folder: CollectionFolder;
  collections: Collection[];
  activeDocument: Document | undefined;
  onCollectionOpen?: () => void;
};

function CollectionFolderLink({
  folder,
  collections,
  activeDocument,
  onCollectionOpen,
}: Props) {
  const { t } = useTranslation();
  const { collectionFolders, dialogs } = useStores();
  const [expanded, setExpanded] = React.useState(false);
  const [menuOpen, handleMenuOpen, handleMenuClose] = useBoolean();

  // Accept collection drops onto the folder header
  const [{ isCollectionOver, isDraggingAnyCollection }, dropRef] = useDrop({
    accept: "collection",
    drop: (item: { id: string }) => {
      void collectionFolders.moveCollection(item.id, folder.id);
      setExpanded(true);
    },
    canDrop: (item: { id: string }) =>
      !collections.some((c) => c.id === item.id),
    collect: (monitor) => ({
      isCollectionOver: !!monitor.isOver({ shallow: true }) && monitor.canDrop(),
      isDraggingAnyCollection: monitor.getItemType() === "collection",
    }),
  });

  const handleDisclosureClick = React.useCallback(
    (ev?: React.MouseEvent<HTMLElement>) => {
      ev?.preventDefault();
      setExpanded((e) => !e);
    },
    []
  );

  const openRenameDialog = React.useCallback(() => {
    dialogs.openModal({
      title: t("Rename folder"),
      content: (
        <RenameFolderDialog
          folder={folder}
          onSubmit={dialogs.closeAllModals}
        />
      ),
    });
  }, [dialogs, folder, t]);

  const openDeleteDialog = React.useCallback(() => {
    dialogs.openModal({
      title: t("Delete folder"),
      content: (
        <ConfirmationDialog
          onSubmit={async () => {
            await collectionFolders.delete(folder);
          }}
          submitText={t("Delete")}
          savingText={`${t("Deleting")}…`}
          danger
        >
          {t(
            "Are you sure you want to delete this folder? Collections inside will not be deleted."
          )}
        </ConfirmationDialog>
      ),
    });
  }, [dialogs, collectionFolders, folder, t]);

  const actionList = React.useMemo(
    () => [
      createAction({
        name: `${t("Rename")}…`,
        icon: <EditIcon />,
        section: GroupSection,
        perform: openRenameDialog,
      }),
      createAction({
        name: `${t("Delete")}…`,
        icon: <TrashIcon />,
        section: GroupSection,
        dangerous: true,
        perform: openDeleteDialog,
      }),
    ],
    [t, openRenameDialog, openDeleteDialog]
  );

  const rootAction = useMenuAction(actionList);

  const menu = (
    <Fade>
      <DropdownMenu
        action={rootAction}
        align="end"
        ariaLabel={t("Folder options")}
        onOpen={handleMenuOpen}
        onClose={handleMenuClose}
      >
        <OverflowMenuButton />
      </DropdownMenu>
    </Fade>
  );

  return (
    <Relative ref={dropRef}>
      <SidebarLink
        label={folder.name}
        icon={<GroupIcon />}
        expanded={expanded}
        onDisclosureClick={handleDisclosureClick}
        depth={0}
        $showActions={menuOpen || (isDraggingAnyCollection && !isCollectionOver)}
        isActiveDrop={isCollectionOver}
        menu={menu}
      />
      <Folder expanded={expanded}>
        <div style={{ paddingInlineStart: 8 }}>
          {collections.map((collection, index) => (
            <DraggableCollectionLink
              key={collection.id}
              collection={collection}
              activeDocument={activeDocument}
              belowCollection={collections[index + 1]}
              onOpen={onCollectionOpen}
            />
          ))}
        </div>
      </Folder>
    </Relative>
  );
}

type RenameFolderDialogProps = {
  folder: CollectionFolder;
  onSubmit: () => void;
};

const RenameFolderDialog = observer(function RenameFolderDialog({
  folder,
  onSubmit,
}: RenameFolderDialogProps) {
  const { t } = useTranslation();
  const { collectionFolders } = useStores();
  const [name, setName] = React.useState(folder.name);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      if (!name.trim()) return;
      setIsSubmitting(true);
      try {
        await collectionFolders.update({ id: folder.id, name: name.trim() });
        onSubmit();
      } finally {
        setIsSubmitting(false);
      }
    },
    [collectionFolders, folder.id, name, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit}>
      <Input
        type="text"
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        autoFocus
        disabled={isSubmitting}
        label={t("Name")}
        required
      />
      <Button type="submit" disabled={isSubmitting || !name.trim()}>
        {isSubmitting ? `${t("Saving")}…` : t("Save")}
      </Button>
    </form>
  );
});

export default observer(CollectionFolderLink);
