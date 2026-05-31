import { debounce } from "es-toolkit/compat";
import { observer } from "mobx-react";
import * as React from "react";
import { Suspense } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import Icon from "@shared/components/Icon";
import { randomElement } from "@shared/random";
import { colorPalette } from "@shared/utils/collections";
import Group from "~/models/Group";
import type User from "~/models/User";
import Invite from "~/scenes/Invite";
import { Avatar, AvatarSize } from "~/components/Avatar";
import Badge from "~/components/Badge";
import Button from "~/components/Button";
import ButtonLink from "~/components/ButtonLink";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import DelayedMount from "~/components/DelayedMount";
import Empty from "~/components/Empty";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import { createLazyComponent } from "~/components/LazyLoad";
import PlaceholderList from "~/components/List/Placeholder";
import PaginatedList from "~/components/PaginatedList";
import { ListItem } from "~/components/Sharing/components/ListItem";
import Text from "~/components/Text";
import Time from "~/components/Time";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import useRequest from "~/hooks/useRequest";
import useStores from "~/hooks/useStores";
import InputMemberPermissionSelect from "~/components/InputMemberPermissionSelect";
import { GroupPermission } from "@shared/types";
import { GroupValidation } from "@shared/validations";
import type { Permission } from "~/types";
import { EmptySelectValue } from "~/types";
import type GroupUser from "~/models/GroupUser";
import Switch from "~/components/Switch";
import history from "~/utils/history";
import { settingsPath } from "~/utils/routeHelpers";

const IconPicker = createLazyComponent(() => import("~/components/IconPicker"));

type Props = {
  group: Group;
  onSubmit: () => void;
};

/**
 * Minimal dialog that lets the user change only the group's icon and color,
 * without touching name / description / other settings.
 * Changes are applied immediately when the user picks an icon (auto-save).
 */
export function GroupIconDialog({ group, onSubmit }: Props) {
  const { t } = useTranslation();
  const [icon, setIcon] = React.useState<string | null>(group.icon ?? "team");
  const [color, setColor] = React.useState<string>(
    group.color ?? randomElement(colorPalette)
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const handleIconChange = React.useCallback(
    async (newIcon: string | null, newColor: string | null) => {
      const resolvedIcon = newIcon ?? undefined;
      const resolvedColor = newColor ?? randomElement(colorPalette);
      setIcon(newIcon);
      setColor(resolvedColor);
      setIsSaving(true);
      try {
        await group.save({ icon: resolvedIcon, color: resolvedColor });
      } catch (err) {
        toast.error(err.message);
      } finally {
        setIsSaving(false);
      }
    },
    [group]
  );

  const initial = group.name.charAt(0).toUpperCase();
  const fallbackIcon = <Icon value={icon ?? "team"} initial={initial} color={color} />;

  return (
    <Flex column gap={16}>
      <Text as="p" type="secondary">
        <Trans>Choose an icon and color for this group.</Trans>
      </Text>
      <Flex justify="center">
        <Suspense fallback={fallbackIcon}>
          <IconPicker.Component
            icon={icon}
            color={color}
            initial={initial}
            popoverPosition="bottom-start"
            onChange={handleIconChange}
          />
        </Suspense>
      </Flex>
      <Button onClick={onSubmit} disabled={isSaving}>
        {isSaving ? `${t("Saving")}…` : t("Done")}
      </Button>
    </Flex>
  );
}

export function CreateGroupDialog() {
  const { dialogs, groups } = useStores();
  const { t } = useTranslation();
  const [name, setName] = React.useState<string | undefined>();
  const [description, setDescription] = React.useState<string | undefined>();
  const [icon, setIcon] = React.useState<string | null>("team");
  const [color, setColor] = React.useState<string>(randomElement(colorPalette));
  const [isSaving, setIsSaving] = React.useState(false);

  const handleIconChange = React.useCallback((newIcon: string | null, newColor: string | null) => {
    setIcon(newIcon);
    setColor(newColor ?? randomElement(colorPalette));
  }, []);

  const handleSubmit = React.useCallback(
    async (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      setIsSaving(true);

      const group = new Group(
        {
          name,
          description,
          icon: icon ?? undefined,
          color,
        },
        groups
      );

      try {
        await group.save();
        dialogs.closeAllModals();
        history.push(settingsPath("groups", group.id, "members"));
      } catch (err) {
        toast.error(err.message);
      } finally {
        setIsSaving(false);
      }
    },
    [dialogs, groups, name, description, icon, color]
  );

  const initial = (name ?? "G").charAt(0).toUpperCase();
  const fallbackIcon = <Icon value="team" initial={initial} color={color} />;

  return (
    <form onSubmit={handleSubmit}>
      <Text as="p" type="secondary">
        <Trans>
          Groups are for organizing your team. They work best when centered
          around a function or a responsibility — Support or Engineering for
          example.
        </Trans>
      </Text>
      <Flex column>
        <Input
          type="text"
          label="Name"
          onChange={(e) => setName(e.target.value)}
          value={name}
          maxLength={GroupValidation.maxNameLength}
          showCharacterCount
          required
          autoFocus
          flex
          prefix={
            <Suspense fallback={fallbackIcon}>
              <StyledIconPicker
                icon={icon}
                color={color}
                initial={initial}
                popoverPosition="right"
                onChange={handleIconChange}
              />
            </Suspense>
          }
        />
        <Input
          type="textarea"
          label="Description"
          placeholder={t("Optional")}
          onChange={(e) => setDescription(e.target.value)}
          value={description || ""}
          maxLength={GroupValidation.maxDescriptionLength}
          flex
        />
      </Flex>
      <Text as="p" type="secondary">
        <Trans>You’ll be able to add people to the group next.</Trans>
      </Text>

      <Button type="submit" disabled={isSaving || !name}>
        {isSaving ? `${t("Creating")}…` : t("Continue")}
      </Button>
    </form>
  );
}

export function EditGroupDialog({ group, onSubmit }: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(group.name);
  const [description, setDescription] = React.useState(group.description || "");
  const [disableMentions, setDisableMentions] = React.useState(
    group.disableMentions || false
  );
  const [icon, setIcon] = React.useState<string | null>(group.icon ?? "team");
  const [color, setColor] = React.useState<string>(
    group.color ?? randomElement(colorPalette)
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const handleIconChange = React.useCallback((newIcon: string | null, newColor: string | null) => {
    setIcon(newIcon);
    setColor(newColor ?? randomElement(colorPalette));
  }, []);

  const handleSubmit = React.useCallback(
    async (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      setIsSaving(true);

      try {
        await group.save({
          name,
          description,
          disableMentions,
          icon: icon ?? undefined,
          color,
        });
        onSubmit();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setIsSaving(false);
      }
    },
    [group, onSubmit, name, description, disableMentions, icon, color]
  );

  const handleNameChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setName(ev.target.value);
    },
    []
  );

  const initial = name.charAt(0).toUpperCase();
  const fallbackIcon = <Icon value={icon ?? "team"} initial={initial} color={color} />;


  return (
    <form onSubmit={handleSubmit}>
      <Text as="p" type="secondary">
        {group.isExternallyManaged ? (
          <Trans>
            This group is managed by an external authentication provider. The
            name is synced automatically and cannot be changed.
          </Trans>
        ) : (
          <Trans>
            You can edit the name of this group at any time, however doing so
            too often might confuse your team mates.
          </Trans>
        )}
      </Text>
      <Flex column>
        <Input
          type="text"
          label={t("Name")}
          onChange={handleNameChange}
          value={name}
          maxLength={GroupValidation.maxNameLength}
          showCharacterCount
          disabled={group.isExternallyManaged}
          required
          autoFocus
          flex
          prefix={
            <Suspense fallback={fallbackIcon}>
              <StyledIconPicker
                icon={icon}
                color={color}
                initial={initial}
                popoverPosition="right"
                onChange={handleIconChange}
              />
            </Suspense>
          }
        />
        <Input
          type="textarea"
          label={t("Description")}
          placeholder={t("Optional")}
          onChange={(e) => setDescription(e.target.value)}
          value={description}
          maxLength={GroupValidation.maxDescriptionLength}
          flex
        />
        <Switch
          id="mentions"
          label={t("Hidden")}
          note={t(
            "Prevent this group from being mentionable in documents or comments"
          )}
          checked={disableMentions}
          onChange={setDisableMentions}
        />
      </Flex>

      <Button type="submit" disabled={isSaving || !name}>
        {isSaving ? `${t("Saving")}…` : t("Save")}
      </Button>
    </form>
  );
}

export function DeleteGroupDialog({ group, onSubmit }: Props) {
  const { t } = useTranslation();

  const handleSubmit = async () => {
    await group.delete();
    onSubmit();
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("I’m sure – Delete")}
      savingText={`${t("Deleting")}…`}
      danger
    >
      <Trans
        defaults="Are you sure about that? Deleting the <em>{{groupName}}</em> group will cause its members to lose access to collections and documents that it is associated with."
        values={{
          groupName: group.name,
        }}
        components={{
          em: <strong />,
        }}
      />
    </ConfirmationDialog>
  );
}

export const AddPeopleToGroupDialog = observer(function ({
  group,
}: Pick<Props, "group">) {
  const { dialogs, users, groupUsers } = useStores();
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const can = usePolicy(team);
  const [query, setQuery] = React.useState("");

  const debouncedFetch = React.useMemo(
    () => debounce((q) => users.fetchPage({ query: q }), 250),
    [users]
  );

  const handleFilter = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const updatedQuery = ev.target.value;
      setQuery(updatedQuery);
      void debouncedFetch(updatedQuery);
    },
    [debouncedFetch]
  );

  const handleAddUser = React.useCallback(
    async (user: User) => {
      try {
        await groupUsers.create({
          groupId: group.id,
          userId: user.id,
        });

        toast.success(
          t(`{{userName}} was added to the group`, {
            userName: user.name,
          }),
          {
            icon: <Avatar model={user} size={AvatarSize.Toast} />,
          }
        );
      } catch (_err) {
        toast.error(t("Could not add user"));
      }
    },
    [t, groupUsers, group.id]
  );

  const handleInvitePeople = React.useCallback(() => {
    dialogs.openModal({
      title: t("Invite people"),
      content: <Invite onSubmit={dialogs.closeAllModals} />,
      replace: true,
    });
  }, [t, dialogs]);

  const { loading } = useRequest(
    React.useCallback(
      () => groupUsers.fetchAll({ id: group.id }),
      [groupUsers, group]
    ),
    true
  );

  return (
    <Flex column>
      <Text as="p" type="secondary">
        {t(
          "Add members below to give them access to the group. Need to add someone who’s not yet a member?"
        )}{" "}
        {can.inviteUser ? (
          <ButtonLink onClick={handleInvitePeople}>
            {t("Invite them to {{teamName}}", {
              teamName: team.name,
            })}
          </ButtonLink>
        ) : (
          t("Ask an admin to invite them first")
        )}
        .
      </Text>
      <Input
        type="search"
        placeholder={`${t("Search by name")}…`}
        value={query}
        onChange={handleFilter}
        label={t("Search people")}
        labelHidden
        autoFocus
        flex
      />
      {loading ? (
        <DelayedMount>
          <PlaceholderList count={5} />
        </DelayedMount>
      ) : (
        <PaginatedList<User>
          empty={
            query ? (
              <Empty>{t("No people matching your search")}</Empty>
            ) : (
              <Empty>{t("No people left to add")}</Empty>
            )
          }
          items={users.notInGroup(group.id, query)}
          fetch={query ? undefined : users.fetchPage}
          renderItem={(item) => (
            <GroupMemberListItem
              key={item.id}
              user={item}
              group={group}
              groupUser={undefined}
              onAdd={() => handleAddUser(item)}
            />
          )}
        />
      )}
    </Flex>
  );
});

type GroupMemberListItemProps = {
  user: User;
  group: Group;
  groupUser: GroupUser | undefined;
  onAdd?: () => Promise<void>;
  onRemove?: () => Promise<void>;
};

const GroupMemberListItem = observer(function ({
  user,
  group,
  groupUser,
  onAdd,
}: GroupMemberListItemProps) {
  const { t } = useTranslation();
  const { groupUsers } = useStores();
  const can = usePolicy(group);

  const permissions = React.useMemo(
    () =>
      [
        {
          label: t("Group admin"),
          value: GroupPermission.Admin,
        },
        {
          label: t("Member"),
          value: GroupPermission.Member,
        },
        {
          divider: true,
          label: t("Remove"),
          value: EmptySelectValue,
        },
      ] as Permission[],
    [t]
  );

  return (
    <ListItem
      title={user.name}
      subtitle={
        <>
          {user.lastActiveAt ? (
            <Trans>
              Active <Time dateTime={user.lastActiveAt} /> ago
            </Trans>
          ) : (
            t("Never signed in")
          )}{" "}
          {user.isInvited && <Badge>{t("Invited")}</Badge>}
          {user.isAdmin && <Badge primary={user.isAdmin}>{t("Admin")}</Badge>}
        </>
      }
      image={<Avatar model={user} size={AvatarSize.Large} />}
      actions={
        <Flex align="center">
          {onAdd ? (
            <Button onClick={onAdd} neutral>
              {t("Add")}
            </Button>
          ) : (
            <div style={{ marginRight: -8 }}>
              <InputMemberPermissionSelect
                permissions={permissions}
                onChange={async (
                  permission: GroupPermission | typeof EmptySelectValue
                ) => {
                  try {
                    if (permission === EmptySelectValue) {
                      await groupUsers.delete({
                        userId: user.id,
                        groupId: group.id,
                      });
                    } else {
                      await groupUsers.update({
                        userId: user.id,
                        groupId: group.id,
                        permission,
                      });
                    }
                  } catch (err) {
                    toast.error(err.message);
                    return false;
                  }
                  return true;
                }}
                disabled={!can.update || group.isExternallyManaged}
                value={groupUser?.permission}
              />
            </div>
          )}
        </Flex>
      }
    />
  );
});

const StyledIconPicker = styled(IconPicker.Component)`
  margin-left: 4px;
  margin-right: 4px;
`;
