import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  DataType,
  BelongsTo,
  ForeignKey,
  HasMany,
  Table,
  Length,
} from "sequelize-typescript";
import Collection from "./Collection";
import Team from "./Team";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

@Table({ tableName: "collection_folders", modelName: "collectionFolder" })
@Fix
class CollectionFolder extends IdModel<
  InferAttributes<CollectionFolder>,
  Partial<InferCreationAttributes<CollectionFolder>>
> {
  @Column
  name: string;

  @Length({
    max: 256,
    msg: `index must be 256 characters or less`,
  })
  @Column
  index: string | null;

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @HasMany(() => Collection, "folderId")
  collections: Collection[];
}

export default CollectionFolder;
