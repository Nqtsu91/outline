import lazyWithRetry from "~/utils/lazyWithRetry";

// The project tree editor is code-split so its logic only loads when a tree
// document is opened.
const TreeEditor = lazyWithRetry(() => import("./TreeEditor"));

export default TreeEditor;
