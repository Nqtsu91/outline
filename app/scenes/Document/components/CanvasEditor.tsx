import { Excalidraw, restoreElements } from "@excalidraw/excalidraw";
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
  scrollToContent: (target?: any, opts?: any) => void;
};

type SceneData = { elements: any[]; files?: any } | null;

function toInitialData(data: any): SceneData {
  if (!data || !Array.isArray(data.elements)) {
    return null;
  }
  // Normalize through Excalidraw's restore helper. This is required for
  // freehand ("freedraw") strokes to render — injecting raw elements directly
  // leaves their cached path unregenerated so they appear invisible.
  const elements = restoreElements(data.elements, null) as any[];
  return { elements, files: data.files ?? undefined };
}

/**
 * Renders an infinite whiteboard (Excalidraw) for documents of type "canvas".
 * The scene is loaded from and autosaved to the document's `canvasData` field.
 * Real-time collaboration is intentionally not enabled — saves are debounced
 * and last-write-wins.
 */
function CanvasEditor({ document, readOnly }: Props) {
  const { documents } = useStores();
  const [api, setApi] = React.useState<ExcalidrawApi | null>(null);

  // Resolve the initial scene before mounting Excalidraw, so a saved drawing is
  // never missed because `canvasData` arrived a tick after mount. `undefined`
  // means "still resolving"; `null` means "fresh, empty canvas".
  const [initial, setInitial] = React.useState<SceneData | undefined>(() =>
    document.canvasData ? toInitialData(document.canvasData) : undefined
  );

  React.useEffect(() => {
    if (initial !== undefined) {
      return;
    }
    const resolved = toInitialData(document.canvasData);
    if (resolved) {
      setInitial(resolved);
    }
  }, [document.canvasData, initial]);

  React.useEffect(() => {
    if (initial !== undefined) {
      return;
    }
    // Fall back to an empty canvas if no data has resolved shortly after mount.
    const timer = setTimeout(
      () => setInitial((cur) => (cur === undefined ? null : cur)),
      700
    );
    return () => clearTimeout(timer);
  }, [initial]);

  // Recenter on the saved content once the editor API is ready.
  const centeredRef = React.useRef(false);
  React.useEffect(() => {
    if (!api || centeredRef.current) {
      return;
    }
    const elements = api.getSceneElements();
    if (elements.length > 0) {
      centeredRef.current = true;
      try {
        api.scrollToContent(elements, { fitToContent: true });
      } catch (_err) {
        // scrollToContent signature differs slightly across versions; ignore.
      }
    }
  }, [api, initial]);

  // Debounced autosave with a guaranteed flush on unmount.
  const pendingRef = React.useRef<{ elements: any; files: any } | null>(null);
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
    const canvasData = {
      elements: pending.elements,
      files: pending.files ?? {},
    } as unknown as JSONObject;
    void documents
      .update({ id: document.id, canvasData })
      .catch((err: Error) => {
        Logger.error("Failed to save canvas", err);
        toast.error(err.message);
      });
  }, [documents, document.id]);

  const handleChange = React.useCallback(
    (elements: any, _appState: any, files: any) => {
      if (readOnly) {
        return;
      }
      pendingRef.current = { elements, files };
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, 400);
    },
    [readOnly, flush]
  );

  React.useEffect(() => () => flush(), [flush]);

  if (initial === undefined) {
    return <Container />;
  }

  return (
    <Container>
      <Excalidraw
        excalidrawAPI={setApi as any}
        initialData={
          initial ? { ...initial, scrollToContent: true } : undefined
        }
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
