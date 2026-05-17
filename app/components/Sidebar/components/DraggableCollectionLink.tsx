import fractionalIndex from "fractional-index";
import { observer } from "mobx-react";
import * as React from "react";
import { useEffect } from "react";
import type { DropTargetMonitor } from "react-dnd";
import { useDrop, useDrag } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import styled from "styled-components";
import type Collection from "~/models/Collection";
import type Document from "~/models/Document";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import useStores from "~/hooks/useStores";
import type { DragObject } from "../hooks/useDragAndDrop";
import CollectionLink from "./CollectionLink";
import DropCursor from "./DropCursor";
import SidebarDisclosureContext, {
  useSidebarDisclosureState,
} from "./SidebarDisclosureContext";
import Relative from "./Relative";

type Props = {
  collection: Collection;
  activeDocument: Document | undefined;
  belowCollection: Collection | void;
  onOpen?: () => void;
};

function DraggableCollectionLink({
  collection,
  activeDocument,
  belowCollection,
  onOpen,
}: Props) {
  const { policies, collections } = useStores();
  const belowCollectionIndex = belowCollection ? belowCollection.index : null;

  // Stop NavLink's fast-click (mousedown → navigate) from firing while the user
  // might be starting a drag. React synthetic stopPropagation only affects the
  // React event system — it does NOT block the native HTML5 dragstart.
  const stopMouseDown = React.useCallback((ev: React.MouseEvent) => {
    ev.stopPropagation();
  }, []);

  // Context-based recursive expand/collapse for descendant DocumentLinks
  const { event: disclosureEvent, onDisclosureClick } =
    useSidebarDisclosureState();

  // Drop to reorder collection
  const [
    { isCollectionDropping, isDraggingAnyCollection },
    dropToReorderCollection,
  ] = useDrop({
    accept: "collection",
    drop: (item: DragObject) => {
      void collections.move(
        item.id,
        fractionalIndex(collection.index, belowCollectionIndex)
      );
    },
    canDrop: (item) =>
      collection.id !== item.id &&
      (!belowCollection || item.id !== belowCollection.id) &&
      policies.abilities(item.id)?.move,
    collect: (monitor: DropTargetMonitor<Collection, Collection>) => ({
      isCollectionDropping: monitor.isOver(),
      isDraggingAnyCollection: monitor.canDrop(),
    }),
  });

  // Drag to reorder collection
  const [{ isDragging }, dragToReorderCollection, preview] = useDrag({
    type: "collection",
    item: () => ({
      id: collection.id,
      title: collection.name,
      icon: <CollectionIcon collection={collection} />,
    }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: false });
  }, [preview]);

  return (
    <SidebarDisclosureContext.Provider value={disclosureEvent}>
      <Draggable
        key={collection.id}
        ref={dragToReorderCollection}
        $isDragging={isDragging}
        onMouseDownCapture={stopMouseDown}
        onClick={onOpen}
      >
        <CollectionLink
          collection={collection}
          expanded={undefined}
          activeDocument={activeDocument}
          onDisclosureClick={() => undefined}
          isDraggingAnyCollection={isDraggingAnyCollection}
        />
      </Draggable>
      <Relative>
        {isDraggingAnyCollection && (
          <DropCursor
            isActiveDrop={isCollectionDropping}
            innerRef={dropToReorderCollection}
          />
        )}
      </Relative>
    </SidebarDisclosureContext.Provider>
  );
}

const Draggable = styled("div")<{ $isDragging: boolean }>`
  transition: opacity 250ms ease;
  opacity: ${(props) => (props.$isDragging ? 0.1 : 1)};
  pointer-events: ${(props) => (props.$isDragging ? "none" : "inherit")};
`;

export default observer(DraggableCollectionLink);
