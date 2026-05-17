import { observable } from "mobx";
import type CollectionFoldersStore from "~/stores/CollectionFoldersStore";
import Model from "./base/Model";
import Field from "./decorators/Field";

class CollectionFolder extends Model {
  static modelName = "CollectionFolder";

  store: CollectionFoldersStore;

  /** The name of the folder. */
  @Field
  @observable
  name: string;

  /** The sort index of the folder. */
  @Field
  @observable
  index: string;

  /** The team this folder belongs to. */
  @observable
  teamId: string;
}

export default CollectionFolder;
