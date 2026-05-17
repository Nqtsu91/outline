import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import { Collection, CollectionFolder } from "@server/models";
import { authorize } from "@server/policies";
import presentCollectionFolder from "@server/presenters/collectionFolder";
import type { APIContext } from "@server/types";
import pagination from "../middlewares/pagination";

const router = new Router();

router.post("collectionFolders.create", auth(), async (ctx: APIContext) => {
  const { name, index } = ctx.request.body as {
    name: string;
    index?: string;
  };
  const { user } = ctx.state.auth;

  if (!name) {
    ctx.throw(400, "name is required");
  }

  // Build an unsaved instance so the policy can check teamId membership
  const folderToCreate = CollectionFolder.build({
    name,
    index: index ?? null,
    teamId: user.teamId,
  });
  authorize(user, "create", folderToCreate);

  await folderToCreate.save();

  ctx.body = {
    data: presentCollectionFolder(folderToCreate),
  };
});

router.post("collectionFolders.update", auth(), async (ctx: APIContext) => {
  const { id, name } = ctx.request.body as { id: string; name: string };
  const { user } = ctx.state.auth;

  if (!id) {
    ctx.throw(400, "id is required");
  }
  if (!name) {
    ctx.throw(400, "name is required");
  }

  const folder = await CollectionFolder.findByPk(id);

  if (!folder || folder.teamId !== user.teamId) {
    ctx.throw(404, "Collection folder not found");
  }

  authorize(user, "update", folder);

  await folder.update({ name });

  ctx.body = {
    data: presentCollectionFolder(folder),
  };
});

router.post("collectionFolders.delete", auth(), async (ctx: APIContext) => {
  const { id } = ctx.request.body as { id: string };
  const { user } = ctx.state.auth;

  if (!id) {
    ctx.throw(400, "id is required");
  }

  const folder = await CollectionFolder.findByPk(id);

  if (!folder || folder.teamId !== user.teamId) {
    ctx.throw(404, "Collection folder not found");
  }

  authorize(user, "delete", folder);

  // Reset folderId to null for all collections in this folder before deleting
  await Collection.update(
    { folderId: null },
    { where: { folderId: id } }
  );

  await folder.destroy();

  ctx.body = {
    success: true,
  };
});

router.post(
  "collectionFolders.list",
  auth(),
  pagination(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    const folders = await CollectionFolder.findAll({
      where: {
        teamId: user.teamId,
      },
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
      order: [["createdAt", "ASC"]],
    });

    ctx.body = {
      pagination: ctx.state.pagination,
      data: folders.map(presentCollectionFolder),
    };
  }
);

router.post("collectionFolders.move", auth(), async (ctx: APIContext) => {
  const { collectionId, folderId } = ctx.request.body as {
    collectionId: string;
    folderId: string | null;
  };
  const { user } = ctx.state.auth;

  if (!collectionId) {
    ctx.throw(400, "collectionId is required");
  }

  const collection = await Collection.findByPk(collectionId);

  if (!collection) {
    ctx.throw(404, "Collection not found");
  }

  authorize(user, "read", collection);

  // If folderId is provided, verify the folder belongs to the same team
  if (folderId !== null && folderId !== undefined) {
    const folder = await CollectionFolder.findByPk(folderId);
    if (!folder || folder.teamId !== user.teamId) {
      ctx.throw(404, "Collection folder not found");
    }
  }

  await collection.update({ folderId: folderId ?? null });

  ctx.body = {
    success: true,
  };
});

export default router;
