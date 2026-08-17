import lazyWithRetry from "~/utils/lazyWithRetry";

// Excalidraw is a large, client-only dependency, so the canvas editor is
// code-split and only loaded when a canvas document is opened.
const CanvasEditor = lazyWithRetry(() => import("./CanvasEditor"));

export default CanvasEditor;
