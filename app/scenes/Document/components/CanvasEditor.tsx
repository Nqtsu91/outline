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
    // Restore the canvas background so strokes sharing the default dark color
    // remain visible (they'd otherwise vanish against a dark background).
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

  // Force a fresh load so we never mount Excalidraw from a stale/cached
  // document that is missing its canvasData (the sidebar keeps documents
  // cached, so opening one otherwise skips the network fetch entirely).
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void documents
      .fetch(document.id, { force: true })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documents, document.id]);

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

  if (!ready) {
    return <Container />;
  }

  const initial = toInitialData(document.canvasData);

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
