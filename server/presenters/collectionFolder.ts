import type { CollectionFolder } from "@server/models";

export default function presentCollectionFolder(folder: CollectionFolder) {
  return {
    id: folder.id,
    name: folder.name,
    teamId: folder.teamId,
    index: folder.index,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}
