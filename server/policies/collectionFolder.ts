import { User, CollectionFolder } from "@server/models";
import { allow } from "./cancan";
import { isTeamModel } from "./utils";

allow(User, ["read", "create", "update", "delete"], CollectionFolder, isTeamModel);
