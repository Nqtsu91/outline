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
import { client } from "~/utils/ApiClient";
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

  // Load the scene straight from the server rather than the store, which keeps
  // documents cached (so opening one skips the fetch) and can hand us a stale
  // model without canvasData. `undefined` = loading; `null` = empty canvas.
  const [initial, setInitial] = React.useState<SceneData | undefined>(
    undefined
  );
  React.useEffect(() => {
    let cancelled = false;
    void client
      .post("/documents.info", { id: document.id })
      .then((res: any) => {
        if (cancelled) {
          return;
        }
        const doc = res?.data?.document ?? res?.data;
        setInitial(toInitialData(doc?.canvasData));
      })
      .catch(() => {
        if (!cancelled) {
          setInitial(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [document.id]);

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
