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
type SceneData = {
  elements: any[];
  files?: any;
  appState?: { viewBackgroundColor?: string };
} | null;

function toInitialData(data: any): SceneData {
  if (!data || !Array.isArray(data.elements)) {
    return null;
  }
  return {
    elements: data.elements,
    files: data.files ?? undefined,
    // Restore the canvas background so strokes that share the default dark
    // color remain visible (they'd otherwise vanish on a dark background).
    appState: data.appState?.viewBackgroundColor
      ? { viewBackgroundColor: data.appState.viewBackgroundColor }
      : undefined,
  };
}

/**
 * Renders an infinite whiteboard (Excalidraw) for documents of type "canvas".
 * The scene is loaded from and autosaved to the document's `canvasData` field.
 * No real-time collaboration — saves are debounced and last-write-wins.
 */
function CanvasEditor({ document, readOnly }: Props) {
  const { documents } = useStores();

  // Resolve the initial scene before mounting Excalidraw so a saved drawing is
  // never missed. `undefined` = still resolving; `null` = fresh empty canvas.
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
    const timer = setTimeout(
      () => setInitial((cur) => (cur === undefined ? null : cur)),
      700
    );
    return () => clearTimeout(timer);
  }, [initial]);

  // Debounced autosave with a guaranteed flush on unmount.
  const pendingRef = React.useRef<{
    elements: any;
    files: any;
    viewBackgroundColor?: string;
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
    const canvasData = {
      elements: pending.elements,
      files: pending.files ?? {},
      appState: { viewBackgroundColor: pending.viewBackgroundColor },
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
      pendingRef.current = {
        elements,
        files,
        viewBackgroundColor: appState?.viewBackgroundColor,
      };
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
