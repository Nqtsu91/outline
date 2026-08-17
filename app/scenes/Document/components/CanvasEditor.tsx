import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { debounce } from "es-toolkit/compat";
import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import type Document from "~/models/Document";
import useStores from "~/hooks/useStores";

type Props = {
  /** The canvas document being edited. */
  document: Document;
  /** Whether the canvas is read-only. */
  readOnly?: boolean;
};

/**
 * Renders an infinite whiteboard (Excalidraw) for documents of type "canvas".
 * The scene is loaded from and autosaved to the document's `canvasData` field.
 * Real-time collaboration is intentionally not enabled — saves are debounced
 * and last-write-wins.
 */
function CanvasEditor({ document, readOnly }: Props) {
  const { documents } = useStores();

  // Compute the initial scene once so autosaves don't reset the canvas.
  const initialData = React.useMemo(() => {
    const data = document.canvasData as
      | {
          elements?: unknown;
          appState?: Record<string, unknown>;
          files?: unknown;
        }
      | null
      | undefined;

    if (!data) {
      return null;
    }

    return {
      // oxlint-disable-next-line no-explicit-any
      elements: (data.elements as any) ?? [],
      appState: {
        ...(data.appState ?? {}),
        // never restore transient collaborator presence
        collaborators: undefined,
      },
      // oxlint-disable-next-line no-explicit-any
      files: (data.files as any) ?? undefined,
    };
    // Only computed on mount — subsequent saves must not remount the scene.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = React.useMemo(
    () =>
      debounce(
        // oxlint-disable-next-line no-explicit-any
        (elements: any, appState: any, files: any) => {
          const json = serializeAsJSON(
            elements,
            appState,
            files ?? {},
            "database"
          );
          void documents.update({
            id: document.id,
            canvasData: JSON.parse(json),
          });
        },
        1500
      ),
    [documents, document.id]
  );

  React.useEffect(() => () => persist.flush(), [persist]);

  const handleChange = React.useCallback(
    // oxlint-disable-next-line no-explicit-any
    (elements: any, appState: any, files: any) => {
      if (readOnly) {
        return;
      }
      persist(elements, appState, files);
    },
    [readOnly, persist]
  );

  return (
    <Container>
      <Excalidraw
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
