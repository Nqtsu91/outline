import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { BackIcon } from "outline-icons";
import styled from "styled-components";
import { s } from "@shared/styles";
import { UserPreference } from "@shared/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import type Collection from "~/models/Collection";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import NudeButton from "~/components/NudeButton";
import Scrollable from "~/components/Scrollable";
import Tooltip from "~/components/Tooltip";
import useBoolean from "~/hooks/useBoolean";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import CollectionMenu from "~/menus/CollectionMenu";
import { documentEditPath } from "~/utils/routeHelpers";
import CollectionLinkChildren from "./CollectionLinkChildren";
import Section from "./Section";
import SidebarContext from "./SidebarContext";

type Props = {
  collection: Collection;
  onBack: () => void;
};

function CollectionNavPanel({ collection, onBack }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();
  const history = useHistory();
  const user = useCurrentUser();
  const can = usePolicy(collection);
  const [, handleMenuOpen, handleMenuClose] = useBoolean();

  const handleNewDoc = React.useCallback(async () => {
    const newDocument = await documents.create(
      {
        collectionId: collection.id,
        title: "",
        fullWidth: user.getPreference(UserPreference.FullWidthDocuments),
        data: ProsemirrorHelper.getEmptyDocument(),
      },
      { publish: true }
    );
    collection.addDocument(newDocument);
    history.push({
      pathname: documentEditPath(newDocument),
      state: { sidebarContext: "collections" },
    });
  }, [documents, collection, user, history]);

  return (
    <SidebarContext.Provider value="collections">
      <NavHeader>
        <Tooltip content={t("All collections")} placement="right" delay={500}>
          <BackButton onClick={onBack} aria-label={t("Back to collections")}>
            <BackIcon size={18} />
          </BackButton>
        </Tooltip>
        <IconWrapper>
          <CollectionIcon collection={collection} size={18} />
        </IconWrapper>
        <NavTitle>{collection.name}</NavTitle>
        <CollectionMenu
          collection={collection}
          onOpen={handleMenuOpen}
          onClose={handleMenuClose}
        />
      </NavHeader>
      <Scrollable flex shadow>
        <Section>
          <CollectionLinkChildren
            collection={collection}
            expanded
            prefetchDocument={documents.prefetchDocument}
          />
        </Section>
        {can.createDocument && (
          <Section>
            <NewPageLink onClick={handleNewDoc} depth={0}>
              + {t("New page")}
            </NewPageLink>
          </Section>
        )}
      </Scrollable>
    </SidebarContext.Provider>
  );
}

const NavHeader = styled.div`
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 8px 8px 8px 12px;
  gap: 4px;
  border-bottom: 1px solid ${s("divider")};
`;

const BackButton = styled(NudeButton)`
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: ${s("textSecondary")};

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }
`;

const IconWrapper = styled.span`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  margin-inline-start: 2px;
`;

const NavTitle = styled.div`
  flex: 1;
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${s("text")};
  padding-inline-start: 4px;
  user-select: none;
`;

const NewPageLink = styled.button<{ depth: number }>`
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 16px;
  padding-inline-start: ${(p) => p.depth * 16 + 12}px;
  font-size: 15px;
  font-weight: 475;
  color: ${s("textTertiary")};
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  text-align: start;
  gap: 6px;

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }
`;

export default observer(CollectionNavPanel);
