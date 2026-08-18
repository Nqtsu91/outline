import { Excalidraw } from "@excalidraw/excalidraw";
// Note: @excalidraw/excalidraw 0.17.x injects its own styles via the JS bundle,
// so no separate CSS import is required (that path only exists in 0.18+).
import { observer } from "mobx-react";
import * as React from "react";
import { toast } from "sonner";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import type Document from "~/models/Document";
import Logger from "~/utils/Logger";
import useStores from "~/hooks/useStores";

type Props = {
  /** The canvas document being edited. */
  document: Document;
  /** Whether the canvas is read-only. */
  readOnly?: boolean;
};

// oxlint-disable no-explicit-any
type ExcalidrawApi = {
  updateScene: (scene: any) => void;
  addFiles: (files: any[]) => void;
  getSceneElements: () => readonly any[];
};

/**
 * Renders an infinite whiteboard (Excalidraw) for documents of type "canvas".
 * The scene is loaded from and autosaved to the document's `canvasData` field.
 * Real-time collaboration is intentionally not enabled — saves are debounced
 * and last-write-wins.
 */
function CanvasEditor({ document, readOnly }: Props) {
  const { documents } = useStores();
  const [api, setApi] = React.useState<ExcalidrawApi | null>(null);

  // Compute the initial scene once so autosaves don't reset the canvas. This
  // covers the case where the document is already fully loaded on mount.
  const initialData = React.useMemo(() => {
    const data = document.canvasData as any;
    if (!data) {
      return null;
    }
    return {
      elements: data.elements ?? [],
      appState: { ...(data.appState ?? {}), collaborators: undefined },
      files: data.files ?? undefined,
      scrollToContent: true,
    };
    // Only computed on mount — subsequent saves must not remount the scene.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the document's canvasData arrives after the editor mounts (e.g. it was
  // still loading), push the scene into Excalidraw once.
  const loadedRef = React.useRef(false);
  React.useEffect(() => {
    if (!api || loadedRef.current) {
      return;
    }
    const data = document.canvasData as any;
    if (data && Array.isArray(data.elements) && data.elements.length > 0) {
      // Don't clobber a scene the user has already started drawing.
      if (api.getSceneElements().length === 0) {
        api.updateScene({
          elements: data.elements,
          appState: { ...(data.appState ?? {}), collaborators: undefined },
        });
        if (data.files) {
          api.addFiles(Object.values(data.files));
        }
      }
      loadedRef.current = true;
    }
  }, [api, document.canvasData]);

  // Debounced autosave with a guaranteed flush when the editor unmounts so
  // navigating away never loses the last edits.
  const pendingRef = React.useRef<{
    elements: any;
    appState: any;
    files: any;
  } | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();

  const flush = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }
    pendingRef.current = null;

    // Store the raw elements and files directly — they are plain,
    // JSON-serializable data and fully define the scene. We deliberately drop
    // the transient appState (selection, cursor, collaborators) which can
    // contain non-serializable values.
    const canvasData = {
      elements: pending.elements,
      files: pending.files ?? {},
      appState: {
        viewBackgroundColor: pending.appState?.viewBackgroundColor,
      },
    } as unknown as JSONObject;

    void documents
      .update({ id: document.id, canvasData })
      .catch((err: Error) => {
        Logger.error("Failed to save canvas", err);
        toast.error(err.message);
      });
  }, [documents, document.id]);

  const handleChange = React.useCallback(
    (elements: any, appState: any, files: any) => {
      if (readOnly) {
        return;
      }
      pendingRef.current = { elements, appState, files };
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, 1000);
    },
    [readOnly, flush]
  );

  React.useEffect(() => () => flush(), [flush]);

  return (
    <Container>
      <Excalidraw
        excalidrawAPI={setApi as any}
        initialData={initialData ?? undefined}
        onChange={handleChange}
        viewModeEnabled={readOnly}
        theme="dark"
        UIOptions={{ canvasActions: { toggleTheme: false } }}
      />
    </Container>
  );
}

const Container = styled.div`
  position: relative;
  width: 100%;
  height: calc(100vh - 140px);
  min-height: 480px;
`;

export default observer(CanvasEditor);
