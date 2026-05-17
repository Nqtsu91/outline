import invariant from "invariant";
import { action, runInAction, computed } from "mobx";
import CollectionFolder from "~/models/CollectionFolder";
import type { Properties } from "~/types";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";
import Store from "./base/Store";

export default class CollectionFoldersStore extends Store<CollectionFolder> {
  constructor(rootStore: RootStore) {
    super(rootStore, CollectionFolder);
  }

  @computed
  get orderedData(): CollectionFolder[] {
    const folders = Array.from(this.data.values());

    return folders.sort((a, b) => {
      if (a.index === b.index) {
        return a.updatedAt > b.updatedAt ? -1 : 1;
      }

      return a.index < b.index ? -1 : 1;
    });
  }

  @action
  fetchAll = async (): Promise<CollectionFolder[]> => {
    this.isFetching = true;

    try {
      const res = await client.post("/collectionFolders.list");
      invariant(res?.data, "Data not available");

      return runInAction(`CollectionFoldersStore#fetchAll`, () => {
        const models = res.data.map(this.add);
        this.addPolicies(res.policies);
        this.isLoaded = true;
        return models;
      });
    } finally {
      this.isFetching = false;
    }
  };

  @action
  async create(
    params: Properties<CollectionFolder>
  ): Promise<CollectionFolder> {
    const res = await client.post("/collectionFolders.create", params);
    invariant(res?.data, "Data not available");

    return runInAction(`CollectionFoldersStore#create`, () => {
      const model = this.add(res.data);
      this.addPolicies(res.policies);
      return model;
    });
  }

  @action
  async update(
    params: Properties<CollectionFolder>
  ): Promise<CollectionFolder> {
    const res = await client.post("/collectionFolders.update", params);
    invariant(res?.data, "Data not available");

    return runInAction(`CollectionFoldersStore#update`, () => {
      const model = this.add(res.data);
      this.addPolicies(res.policies);
      return model;
    });
  }

  @action
  async delete(folder: CollectionFolder): Promise<void> {
    await client.post("/collectionFolders.delete", { id: folder.id });
    this.remove(folder.id);
  }

  /**
   * Move a collection into or out of a folder.
   */
  @action
  moveCollection = async (
    collectionId: string,
    folderId: string | null
  ): Promise<void> => {
    await client.post("/collectionFolders.move", { collectionId, folderId });
    runInAction(() => {
      const collection = this.rootStore.collections.get(collectionId);
      if (collection) {
        collection.folderId = folderId;
      }
    });
  };
}
