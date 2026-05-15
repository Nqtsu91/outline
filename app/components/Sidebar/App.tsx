import { observer } from "mobx-react";
import { SearchIcon, HomeIcon, SidebarIcon } from "outline-icons";
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useTranslation } from "react-i18next";
import { useHistory, useLocation } from "react-router-dom";
import styled from "styled-components";
import { metaDisplay } from "@shared/utils/keyboard";
import Scrollable from "~/components/Scrollable";
import { inviteUser } from "~/actions/definitions/users";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePersistedState from "~/hooks/usePersistedState";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import TeamMenu from "~/menus/TeamMenu";
import { homePath, searchPath } from "~/utils/routeHelpers";
import TeamLogo from "../TeamLogo";
import Tooltip from "../Tooltip";
import Sidebar from "./Sidebar";
import ArchiveLink from "./components/ArchiveLink";
import Collections from "./components/Collections";
import CollectionNavPanel from "./components/CollectionNavPanel";
import { DraftsLink } from "./components/DraftsLink";
import DragPlaceholder from "./components/DragPlaceholder";
import HistoryNavigation from "./components/HistoryNavigation";
import Section from "./components/Section";
import SharedWithMe from "./components/SharedWithMe";
import SidebarAction from "./components/SidebarAction";
import SidebarButton from "./components/SidebarButton";
import SidebarLink from "./components/SidebarLink";
import Starred from "./components/Starred";
import ToggleButton from "./components/ToggleButton";
import TrashLink from "./components/TrashLink";
import useMobile from "~/hooks/useMobile";

type SidebarMode = "spaces" | "collection";

function AppSidebar() {
  const { t } = useTranslation();
  const { documents, ui, collections } = useStores();
  const team = useCurrentTeam();
  const user = useCurrentUser();
  const can = usePolicy(team);
  const history = useHistory();
  const { pathname } = useLocation();
  const isMobile = useMobile();

  // Persisted mode: "spaces" shows all collections, "collection" shows the active collection's tree
  const [sidebarMode, setSidebarMode] = usePersistedState<SidebarMode>(
    "sidebarMode",
    "spaces"
  );

  // Track the last known active collection ID so we can keep showing it
  // even when navigating to pages outside a collection (e.g. Home)
  const lastActiveCollectionIdRef = useRef<string | undefined>(
    ui.activeCollectionId
  );

  // Which collection the user explicitly dismissed via the back button.
  // A dismissed collection won't auto-switch until the user navigates away
  // (route change), at which point we clear the dismissal.
  const dismissedCollectionIdRef = useRef<string | undefined>(undefined);

  // Keep a stable ref to setSidebarMode so the auto-switch effects only run
  // when their intended dependency changes — not when the persisted-state
  // setter recreates itself after a mode change.
  const setSidebarModeRef = useRef(setSidebarMode);
  useLayoutEffect(() => {
    setSidebarModeRef.current = setSidebarMode;
  });

  // On every route change, clear the dismissal and switch to collection mode
  // if we're inside a collection. This handles the case where the user clicks
  // "All Collections", then clicks on the same collection again — the URL
  // changes but activeCollectionId might not, so we rely on pathname here.
  useEffect(() => {
    dismissedCollectionIdRef.current = undefined;
    if (ui.activeCollectionId) {
      lastActiveCollectionIdRef.current = ui.activeCollectionId;
      setSidebarModeRef.current("collection");
    }
    // ui.activeCollectionId intentionally omitted: this effect is for
    // route-change detection only. Changes to activeCollectionId are
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // When activeCollectionId changes (e.g. navigating between collections),
  // auto-switch unless the user has dismissed the current collection.
  useEffect(() => {
    const id = ui.activeCollectionId;
    if (id) {
      lastActiveCollectionIdRef.current = id;
      if (id !== dismissedCollectionIdRef.current) {
        dismissedCollectionIdRef.current = undefined;
        setSidebarModeRef.current("collection");
      }
      // else: same collection was dismissed — stay in spaces mode.
    } else {
      // Left all collection pages — clear dismissal for next collection visit.
      dismissedCollectionIdRef.current = undefined;
    }
  }, [ui.activeCollectionId]);

  // Resolve the collection to show in nav mode: prefer the currently active
  // one; fall back to the last visited one so the panel doesn't flash away
  // when navigating to Home or Search.
  const navCollectionId =
    ui.activeCollectionId ?? lastActiveCollectionIdRef.current;
  const activeCollection = navCollectionId
    ? collections.get(navCollectionId)
    : undefined;

  const showCollectionNav = sidebarMode === "collection" && !!activeCollection;

  const handleBackToSpaces = useCallback(() => {
    // Remember which collection was dismissed so route-less re-renders
    // (e.g. MobX updates on the same page) don't immediately re-open it.
    dismissedCollectionIdRef.current = ui.activeCollectionId;
    setSidebarMode("spaces");
  }, [setSidebarMode, ui.activeCollectionId]);

  const handleSearchClick = useCallback(() => {
    const basePath = searchPath();
    const { pathname, search } = history.location;
    if (pathname.startsWith(basePath) && (search || pathname !== basePath)) {
      history.push(basePath);
    }
  }, [history]);

  useEffect(() => {
    void collections.fetchAll();

    if (!user.isViewer) {
      void documents.fetchDrafts();
    }
  }, [documents, collections, user.isViewer]);

  const [dndArea, setDndArea] = useState();
  const handleSidebarRef = useCallback((node) => setDndArea(node), []);
  const html5Options = useMemo(
    () => ({
      rootElement: dndArea,
    }),
    [dndArea]
  );

  return (
    <Sidebar hidden={!ui.readyToShow} ref={handleSidebarRef}>
      {dndArea && (
        <DndProvider backend={HTML5Backend} options={html5Options}>
          <DragPlaceholder />

          <TeamMenu>
            <SidebarButton
              title={team.name}
              image={<TeamLogo model={team} size={24} alt={t("Logo")} />}
            >
              {isMobile ? null : (
                <Tooltip
                  content={t("Toggle sidebar")}
                  shortcut={`${metaDisplay}+.`}
                >
                  <ToggleButton
                    position="bottom"
                    image={<SidebarIcon />}
                    aria-label={
                      ui.sidebarCollapsed
                        ? t("Expand sidebar")
                        : t("Collapse sidebar")
                    }
                    style={{ paddingInline: 4 }}
                    onClick={() => {
                      ui.toggleCollapsedSidebar();
                      (document.activeElement as HTMLElement)?.blur();
                    }}
                  />
                </Tooltip>
              )}
            </SidebarButton>
          </TeamMenu>

          <Overflow>
            <Section>
              <SidebarLink
                to={homePath()}
                icon={<HomeIcon />}
                exact={false}
                label={t("Home")}
              />
              <SidebarLink
                to={searchPath()}
                icon={<SearchIcon />}
                label={t("Search")}
                exact={false}
                onClick={handleSearchClick}
              />
              {can.createDocument && <DraftsLink />}
            </Section>
          </Overflow>

          {showCollectionNav ? (
            <CollectionNavPanel
              collection={activeCollection}
              onBack={handleBackToSpaces}
            />
          ) : (
            <Scrollable flex shadow>
              <Section>
                <Starred />
              </Section>
              <Section>
                <SharedWithMe />
              </Section>
              <Section>
                <Collections />
              </Section>
              {can.createDocument && (
                <Section auto>
                  <ArchiveLink />
                </Section>
              )}
              <Section>
                {can.createDocument && <TrashLink />}
                <SidebarAction action={inviteUser} />
              </Section>
            </Scrollable>
          )}
        </DndProvider>
      )}
      <HistoryNavigation />
    </Sidebar>
  );
}

const Overflow = styled.div`
  overflow: hidden;
  flex-shrink: 0;
`;

export default observer(AppSidebar);
