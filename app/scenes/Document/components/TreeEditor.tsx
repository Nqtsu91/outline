import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import type Document from "~/models/Document";
import { client } from "~/utils/ApiClient";
import useFillViewportHeight from "~/hooks/useFillViewportHeight";
import useStores from "~/hooks/useStores";

/**
 * Project tree editor.
 *
 * An infinite, dark canvas that renders one or more self-aligning trees of
 * rectangular nodes connected by arrows (global elbow/curved style). Nodes
 * carry text, a status color and an optional custom color.
 *
 * Layout is automatic by default: every node has an automatic slot (one
 * column right of its parent, stacked with its siblings). Dragging a node
 * pins it with a manual displacement; pinned nodes show a badge that returns
 * them to their automatic slot, and "Tidy branch" / "Tidy all" clear pins in
 * bulk. Nothing ever moves without an explicit gesture.
 *
 * Controls:
 *  - left-drag on a node moves it alone (its children block stays put);
 *  - Shift+left-drag moves the node with its sub-tree and manual-link targets;
 *  - while dragging, the node snaps to other nodes' columns/rows and to its
 *    own automatic slot (guides are drawn); hold Alt or Ctrl to disable
 *    snapping, press Escape to cancel the drag;
 *  - right-drag (or left-drag on the background) pans the camera;
 *  - hovering a node shows four handles to draw manual links; multiple links
 *    may target the same node;
 *  - clicking any arrow opens a small menu: a manual link can be deleted, a
 *    parent-to-child arrow can be detached (the child becomes its own tree);
 *  - the node toolbar moves a node one level up or down its hierarchy.
 *
 * Supports pan/zoom, fit-to-view, undo/redo and autosave. Connections stretch
 * live while dragging.
 */

type TreeStatus = "not_started" | "in_progress" | "to_validate" | "done";
type Side = "top" | "bottom" | "left" | "right";

type TreeNode = {
  id: string;
  text: string;
  emoji?: string;
  status: TreeStatus;
  color?: string;
  collapsed?: boolean;
  children: string[];
  /**
   * Manual pin: displacement from the automatic slot, relative to the parent.
   * Absent = fully driven by the automatic layout.
   */
  offset?: { x: number; y: number };
  /**
   * Displacement of this node's whole block of children relative to the node.
   * Set when the node is moved alone so its children stay put while remaining
   * automatic among themselves (new children keep stacking with them).
   */
  childrenOffset?: { x: number; y: number };
};

type TreeLink = {
  id: string;
  from: string;
  fromSide: Side;
  to: string;
  toSide: Side;
};

type TreeData = {
  rootIds: string[];
  nodes: Record<string, TreeNode>;
  links?: TreeLink[];
  bgColor?: string;
  /** Global connector style for every arrow on this canvas. */
  arrowStyle?: "elbow" | "curved";
};

type Props = {
  document: Document;
  readOnly?: boolean;
};

const NODE_W = 190;
const NODE_H = 56;
const H_GAP = 72;
const V_GAP = 18;
const TREE_GAP = 2;
const DEFAULT_BG = "#1b211f";
/** Snap distance while dragging, in screen pixels (independent of zoom). */
const SNAP_PX = 8;
/** Larger, two-axis snap radius for the node's own automatic slot. */
const SNAP_AUTO_PX = 14;
/** Minimum gap between two nodes for an edge to use their facing sides. */
const ARROW_CLEARANCE = 48;
const GUIDE_COLOR = "#8fb3ff";

const STATUSES: Record<TreeStatus, { labelKey: string; color: string }> = {
  not_started: { labelKey: "Not started", color: "#6b7280" },
  in_progress: { labelKey: "In progress", color: "#a85a38" },
  to_validate: { labelKey: "To validate", color: "#8f9147" },
  done: { labelKey: "Done", color: "#2f7d4f" },
};
const STATUS_ORDER: TreeStatus[] = [
  "not_started",
  "in_progress",
  "to_validate",
  "done",
];

const nodeColor = (node: TreeNode) => node.color || STATUSES[node.status].color;

function uid() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

function newNode(): TreeNode {
  return {
    id: uid(),
    text: "",
    status: "not_started",
    children: [],
    collapsed: false,
  };
}

type PinField = "offset" | "childrenOffset";

/**
 * Returns a copy of `node` with the given manual displacement shifted by
 * (dx, dy). A displacement that lands back on zero is dropped entirely, so
 * the node is once again fully driven by the automatic layout.
 */
function shiftField(
  node: TreeNode,
  field: PinField,
  dx: number,
  dy: number
): TreeNode {
  const cur = node[field] ?? { x: 0, y: 0 };
  const x = Math.round((cur.x + dx) * 100) / 100;
  const y = Math.round((cur.y + dy) * 100) / 100;
  const { [field]: _dropped, ...rest } = node;
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
    return rest;
  }
  return { ...rest, [field]: { x, y } };
}

const shiftOffset = (node: TreeNode, dx: number, dy: number) =>
  shiftField(node, "offset", dx, dy);

/** A displacement counts only above the same threshold `shiftField` drops at. */
const live = (o?: Point) =>
  !!o && (Math.abs(o.x) >= 0.5 || Math.abs(o.y) >= 0.5);

const isPinned = (node: TreeNode) =>
  live(node.offset) || live(node.childrenOffset);

/** Drops every manual displacement so the node is laid out automatically. */
function unpin(node: TreeNode): TreeNode {
  const { offset: _o, childrenOffset: _c, ...rest } = node;
  return rest;
}

/** Returns a copy of `node` whose children block is laid out automatically. */
function unpinChildren(node: TreeNode): TreeNode {
  const { childrenOffset: _c, ...rest } = node;
  return rest;
}

function defaultTree(): TreeData {
  const node = newNode();
  return { rootIds: [node.id], nodes: { [node.id]: node }, links: [] };
}

function normalize(data: unknown): TreeData | null {
  let raw: unknown = data;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const d = raw as (TreeData & { rootId?: string }) | null;
  if (!d || !d.nodes) {
    return null;
  }
  const links = dedupeLinks(Array.isArray(d.links) ? d.links : []);
  const nodes = migrateNodes(d.nodes);
  if (Array.isArray(d.rootIds) && d.rootIds.length) {
    return {
      rootIds: d.rootIds,
      nodes,
      links,
      bgColor: d.bgColor,
      arrowStyle: d.arrowStyle,
    };
  }
  if (d.rootId && d.nodes[d.rootId]) {
    return {
      rootIds: [d.rootId],
      nodes,
      links,
      bgColor: d.bgColor,
      arrowStyle: d.arrowStyle,
    };
  }
  return null;
}

/**
 * Upgrades node data written by earlier versions without changing a single
 * rendered position:
 *  - zero-length displacements (which were never dropped before) are removed,
 *    so they no longer count as manual pins;
 *  - the old "move alone" encoding, where every child carried the same
 *    compensating offset, becomes one `childrenOffset` on the parent. The
 *    children are automatic again, so the badge, "Tidy branch" and new
 *    siblings behave exactly as for data written by the current code.
 */
function migrateNodes(
  input: Record<string, TreeNode>
): Record<string, TreeNode> {
  const nodes: Record<string, TreeNode> = {};
  Object.keys(input).forEach((id) => {
    let n = input[id];
    if (n.offset && !live(n.offset)) {
      const { offset: _o, ...rest } = n;
      n = rest;
    }
    if (n.childrenOffset && !live(n.childrenOffset)) {
      n = unpinChildren(n);
    }
    nodes[id] = n;
  });
  Object.keys(nodes).forEach((id) => {
    const n = nodes[id];
    if (n.childrenOffset) {
      return;
    }
    const kids = n.children.map((c) => nodes[c]).filter(Boolean);
    const first = kids[0]?.offset;
    if (!kids.length || !first || !live(first)) {
      return;
    }
    const same = kids.every(
      (k) =>
        k.offset &&
        Math.abs(k.offset.x - first.x) < 0.01 &&
        Math.abs(k.offset.y - first.y) < 0.01
    );
    if (!same) {
      return;
    }
    nodes[id] = { ...n, childrenOffset: { x: first.x, y: first.y } };
    kids.forEach((k) => {
      const { offset: _o, ...rest } = k;
      nodes[k.id] = rest;
    });
  });
  return nodes;
}

type Point = { x: number; y: number };
type Positions = Record<string, Point>;

/** Anchor point on a given side of a node rectangle at `pos`. */
function anchor(pos: Point, side: Side): Point {
  switch (side) {
    case "top":
      return { x: pos.x + NODE_W / 2, y: pos.y };
    case "bottom":
      return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H };
    case "left":
      return { x: pos.x, y: pos.y + NODE_H / 2 };
    case "right":
      return { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 };
  }
}

function control(a: Point, side: Side, dist = 60): Point {
  switch (side) {
    case "top":
      return { x: a.x, y: a.y - dist };
    case "bottom":
      return { x: a.x, y: a.y + dist };
    case "left":
      return { x: a.x - dist, y: a.y };
    case "right":
      return { x: a.x + dist, y: a.y };
  }
}

const centerOf = (p: Point): Point => ({
  x: p.x + NODE_W / 2,
  y: p.y + NODE_H / 2,
});

const isHorizontal = (s: Side) => s === "left" || s === "right";

/**
 * Picks the pair of node sides an edge should connect. Whenever there is
 * enough horizontal clearance the edge leaves the source's right side and
 * enters the target's left side, so tree edges always read as a right-facing
 * bracket even for children placed far below; otherwise the dominant axis
 * decides, so the arrow always enters from an outer face and its head is
 * never hidden behind the node.
 */
function pickSides(a: Point, b: Point): { aSide: Side; bSide: Side } {
  if (b.x - (a.x + NODE_W) >= ARROW_CLEARANCE) {
    return { aSide: "right", bSide: "left" };
  }
  if (a.x - (b.x + NODE_W) >= ARROW_CLEARANCE) {
    return { aSide: "left", bSide: "right" };
  }
  if (b.y - (a.y + NODE_H) >= ARROW_CLEARANCE) {
    return { aSide: "bottom", bSide: "top" };
  }
  if (a.y - (b.y + NODE_H) >= ARROW_CLEARANCE) {
    return { aSide: "top", bSide: "bottom" };
  }
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { aSide: "right", bSide: "left" }
      : { aSide: "left", bSide: "right" };
  }
  return dy >= 0
    ? { aSide: "bottom", bSide: "top" }
    : { aSide: "top", bSide: "bottom" };
}

const SIDE_VECS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Returns the stored sides when they still roughly face the other node, and
 * falls back to geometry-picked sides otherwise. This prevents arrows from
 * making U-turns and crossing through nodes after the nodes have been moved
 * to the opposite side of their link anchors.
 */
function effectiveSides(
  pa: Point,
  aSide: Side,
  pb: Point,
  bSide: Side
): { aSide: Side; bSide: Side } {
  const ca = centerOf(pa);
  const cb = centerOf(pb);
  const vx = cb.x - ca.x;
  const vy = cb.y - ca.y;
  const picked = pickSides(pa, pb);
  const aDot = SIDE_VECS[aSide].x * vx + SIDE_VECS[aSide].y * vy;
  const bDot = SIDE_VECS[bSide].x * -vx + SIDE_VECS[bSide].y * -vy;
  return {
    aSide: aDot >= 0 ? aSide : picked.aSide,
    bSide: bDot >= 0 ? bSide : picked.bSide,
  };
}

/**
 * Builds the SVG path for an edge between two nodes in the canvas-wide style.
 * Both styles leave the source and enter the target perpendicular to the
 * chosen sides, keeping the arrowhead outside the node rectangle.
 */
function routeEdge(
  pa: Point,
  aSide: Side,
  pb: Point,
  bSide: Side,
  style: "elbow" | "curved"
): string {
  const a = anchor(pa, aSide);
  const b = anchor(pb, bSide);
  if (style === "curved") {
    const c1 = control(a, aSide);
    const c2 = control(b, bSide);
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  }
  const ea = control(a, aSide, 24);
  const eb = control(b, bSide, 24);
  let mid: string;
  if (isHorizontal(aSide) && isHorizontal(bSide)) {
    const midX = (ea.x + eb.x) / 2;
    mid = `L ${midX} ${ea.y} L ${midX} ${eb.y}`;
  } else if (!isHorizontal(aSide) && !isHorizontal(bSide)) {
    const midY = (ea.y + eb.y) / 2;
    mid = `L ${ea.x} ${midY} L ${eb.x} ${midY}`;
  } else if (isHorizontal(aSide)) {
    mid = `L ${eb.x} ${ea.y}`;
  } else {
    mid = `L ${ea.x} ${eb.y}`;
  }
  return `M ${a.x} ${a.y} L ${ea.x} ${ea.y} ${mid} L ${eb.x} ${eb.y} L ${b.x} ${b.y}`;
}

/**
 * Drops exact duplicates (same nodes and same sides). Identical links stack
 * exactly on top of each other, so deleting one looked like the arrow could
 * not be deleted. Links between the same nodes on different sides are
 * distinct arrows and are kept.
 */
function dedupeLinks(links: TreeLink[]): TreeLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.from}>${l.to}>${l.fromSide}>${l.toSide}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Tree-parent of `id` (children arrays only), or undefined for a root. */
function findParent(tree: TreeData, id: string): string | undefined {
  return Object.keys(tree.nodes).find((pid) =>
    tree.nodes[pid].children.includes(id)
  );
}

/** Copy of `node` without its own pin, keeping its children block as is. */
function unpinSelf(node: TreeNode): TreeNode {
  const { offset: _o, ...rest } = node;
  return rest;
}

/** Copy of `parent` without child `id`; a now-empty block loses its pin. */
function withoutChild(parent: TreeNode, id: string): TreeNode {
  const children = parent.children.filter((c) => c !== id);
  return { ...(children.length ? parent : unpinChildren(parent)), children };
}

/**
 * Moves `id` (with its sub-tree) one level up: it becomes the next sibling of
 * its former parent, or a tree of its own when that parent was a root. The
 * node takes its new automatic slot. Returns null for a root.
 */
function promotedTree(tree: TreeData, id: string): TreeData | null {
  const parentId = findParent(tree, id);
  const node = tree.nodes[id];
  if (!node || !parentId) {
    return null;
  }
  const nodes = {
    ...tree.nodes,
    [id]: unpinSelf(node),
    [parentId]: withoutChild(tree.nodes[parentId], id),
  };
  const grandId = findParent(tree, parentId);
  if (grandId) {
    const siblings = [...nodes[grandId].children];
    siblings.splice(siblings.indexOf(parentId) + 1, 0, id);
    nodes[grandId] = { ...nodes[grandId], children: siblings };
    return { ...tree, nodes };
  }
  const rootIds = [...tree.rootIds];
  const at = rootIds.indexOf(parentId);
  rootIds.splice(at < 0 ? rootIds.length : at + 1, 0, id);
  return { ...tree, rootIds, nodes };
}

/**
 * Moves `id` (with its sub-tree) one level down: it becomes a child of the
 * sibling just above it (appended last), or of the sibling just below when it
 * is the first one (inserted first). Returns null when it has no sibling.
 */
function demotedTree(tree: TreeData, id: string): TreeData | null {
  const node = tree.nodes[id];
  if (!node) {
    return null;
  }
  const parentId = findParent(tree, id);
  const siblings = (
    parentId ? tree.nodes[parentId].children : tree.rootIds
  ).filter((s) => tree.nodes[s]);
  const index = siblings.indexOf(id);
  if (index < 0) {
    return null;
  }
  const above = siblings[index - 1];
  const targetId = above ?? siblings[index + 1];
  if (!targetId) {
    return null;
  }
  const target = tree.nodes[targetId];
  const base = target.children.length ? target : unpinChildren(target);
  const nodes = {
    ...tree.nodes,
    [id]: unpinSelf(node),
    [targetId]: {
      ...base,
      collapsed: false,
      children: above ? [...target.children, id] : [id, ...target.children],
    },
  };
  if (parentId) {
    nodes[parentId] = withoutChild(nodes[parentId], id);
    return { ...tree, nodes };
  }
  return { ...tree, rootIds: tree.rootIds.filter((r) => r !== id), nodes };
}

/**
 * Cuts the parent-to-child arrow above `id`: the node (with its sub-tree)
 * becomes a tree of its own and is pinned where it currently sits, so
 * removing the arrow does not move it. Returns null for a root.
 */
function detachedTree(tree: TreeData, id: string): TreeData | null {
  const parentId = findParent(tree, id);
  const node = tree.nodes[id];
  if (!node || !parentId) {
    return null;
  }
  const next: TreeData = {
    ...tree,
    rootIds: [...tree.rootIds, id],
    nodes: {
      ...tree.nodes,
      [id]: unpinSelf(node),
      [parentId]: withoutChild(tree.nodes[parentId], id),
    },
  };
  const before = computeLayout(tree).positions[id];
  const slot = computeLayout(next).positions[id];
  if (before && slot) {
    next.nodes[id] = shiftOffset(
      next.nodes[id],
      before.x - slot.x,
      before.y - slot.y
    );
  }
  return next;
}

type SnapCandidate = {
  /** Value the dragged node's left/top should take to snap. */
  v: number;
  /** Rectangle origin of the node that produced this candidate. */
  src: Point;
  /** True for the node's own automatic (tidy) slot. */
  tidy?: boolean;
};

/**
 * Picks the closest candidate within `threshold`, preferring the automatic
 * slot on ties so dragging a node back home re-engages the auto layout.
 */
function snapAxis(
  value: number,
  cands: SnapCandidate[],
  threshold: number
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestD = threshold;
  for (const c of cands) {
    const d = Math.abs(c.v - value);
    if (d < bestD || (d === bestD && c.tidy && best && !best.tidy)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Two-pass layout: a tidy auto-layout, then per-node manual offsets applied
 * cumulatively down the tree so moving a node carries its whole sub-tree.
 * Positions are absolute and stable — the canvas never re-anchors content to
 * fit the viewport when a node moves.
 */
function computeLayout(tree: TreeData): {
  positions: Positions;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const base: Positions = {};
  let leaf = 0;

  const walk = (id: string, depth: number): number => {
    const node = tree.nodes[id];
    if (!node) {
      return 0;
    }
    const x = depth * (NODE_W + H_GAP);
    const kids = node.collapsed
      ? []
      : node.children.filter((c) => tree.nodes[c]);
    if (kids.length === 0) {
      const y = leaf * (NODE_H + V_GAP);
      leaf++;
      base[id] = { x, y };
      return y;
    }
    const ys = kids.map((cid) => walk(cid, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    base[id] = { x, y };
    return y;
  };
  tree.rootIds.forEach((rootId) => {
    if (tree.nodes[rootId]) {
      walk(rootId, 0);
      leaf += TREE_GAP;
    }
  });

  // Cumulative manual displacements: a node's pin, plus the displacement of
  // its parent's children block.
  const cum: Positions = {};
  const walkCum = (id: string, px: number, py: number) => {
    const node = tree.nodes[id];
    const off = node?.offset ?? { x: 0, y: 0 };
    const co = node?.childrenOffset ?? { x: 0, y: 0 };
    const x = px + off.x;
    const y = py + off.y;
    cum[id] = { x, y };
    node?.children.forEach((c) => walkCum(c, x + co.x, y + co.y));
  };
  tree.rootIds.forEach((rootId) => walkCum(rootId, 0, 0));

  const positions: Positions = {};
  Object.keys(base).forEach((id) => {
    positions[id] = {
      x: base[id].x + (cum[id]?.x ?? 0),
      y: base[id].y + (cum[id]?.y ?? 0),
    };
  });

  const xs = Object.values(positions).map((p) => p.x);
  const ys = Object.values(positions).map((p) => p.y);
  return {
    positions,
    bounds: {
      minX: xs.length ? Math.min(...xs) : 0,
      minY: ys.length ? Math.min(...ys) : 0,
      maxX: xs.length ? Math.max(...xs) : 0,
      maxY: ys.length ? Math.max(...ys) : 0,
    },
  };
}

function TreeEditorInner({
  document,
  readOnly,
  initialTree,
}: Props & { initialTree: TreeData }) {
  const { t } = useTranslation();
  const { documents } = useStores();

  const [tree, setTree] = React.useState<TreeData>(initialTree);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );

  const history = React.useRef<TreeData[]>([tree]);
  const historyIndex = React.useRef(0);
  // Latest tree for long-lived pointer handlers, which must not commit from
  // the snapshot they closed over at pointer-down (a text blur or an undo
  // can land mid-drag).
  const treeRef = React.useRef(tree);
  treeRef.current = tree;

  const persistTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const pendingSaveRef = React.useRef<TreeData | null>(null);
  const scheduleSave = React.useCallback(
    (next: TreeData) => {
      pendingSaveRef.current = next;
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
      }
      persistTimer.current = setTimeout(() => {
        pendingSaveRef.current = null;
        void documents.update({
          id: document.id,
          canvasData: next as unknown as JSONObject,
        });
      }, 400);
    },
    [documents, document.id]
  );

  React.useEffect(
    () => () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
      }
      if (pendingSaveRef.current) {
        void documents.update({
          id: document.id,
          canvasData: pendingSaveRef.current as unknown as JSONObject,
        });
      }
    },
    [documents, document.id]
  );

  const commit = React.useCallback(
    (next: TreeData) => {
      history.current = history.current.slice(0, historyIndex.current + 1);
      history.current.push(next);
      historyIndex.current = history.current.length - 1;
      setTree(next);
      scheduleSave(next);
    },
    [scheduleSave]
  );

  const undo = React.useCallback(() => {
    if (historyIndex.current > 0) {
      historyIndex.current -= 1;
      const state = history.current[historyIndex.current];
      setTree(state);
      scheduleSave(state);
    }
  }, [scheduleSave]);

  const redo = React.useCallback(() => {
    if (historyIndex.current < history.current.length - 1) {
      historyIndex.current += 1;
      const state = history.current[historyIndex.current];
      setTree(state);
      scheduleSave(state);
    }
  }, [scheduleSave]);

  // ---- mutations -----------------------------------------------------------

  const updateNode = React.useCallback(
    (id: string, patch: Partial<TreeNode>) => {
      commit({
        ...tree,
        nodes: { ...tree.nodes, [id]: { ...tree.nodes[id], ...patch } },
      });
    },
    [tree, commit]
  );

  const addChild = React.useCallback(
    (parentId: string) => {
      const parent = tree.nodes[parentId];
      if (!parent) {
        return;
      }
      const child = newNode();
      // A first child always lands in its automatic slot beside the parent:
      // a stale children-block displacement must not apply to it.
      const base = parent.children.length ? parent : unpinChildren(parent);
      commit({
        ...tree,
        nodes: {
          ...tree.nodes,
          [child.id]: child,
          [parentId]: {
            ...base,
            collapsed: false,
            children: [...parent.children, child.id],
          },
        },
      });
      setSelectedId(child.id);
      setEditingId(child.id);
    },
    [tree, commit]
  );

  const addRoot = React.useCallback(() => {
    const node = newNode();
    commit({
      ...tree,
      rootIds: [...tree.rootIds, node.id],
      nodes: { ...tree.nodes, [node.id]: node },
    });
    setSelectedId(node.id);
    setEditingId(node.id);
  }, [tree, commit]);

  const collectSubtree = React.useCallback(
    (id: string, acc: string[]) => {
      acc.push(id);
      tree.nodes[id]?.children.forEach((c) => collectSubtree(c, acc));
      return acc;
    },
    [tree]
  );

  const deleteNode = React.useCallback(
    (id: string) => {
      const ids = collectSubtree(id, []);
      const idSet = new Set(ids);
      const nodes = { ...tree.nodes };
      ids.forEach((nid) => delete nodes[nid]);
      Object.keys(nodes).forEach((nid) => {
        if (nodes[nid].children.some((c) => idSet.has(c))) {
          const remaining = nodes[nid].children.filter((c) => !idSet.has(c));
          // A children-block displacement has nothing left to displace once
          // the last child is gone; drop it so the next child lands beside
          // its parent rather than where the old block used to be.
          const parent = remaining.length
            ? nodes[nid]
            : unpinChildren(nodes[nid]);
          nodes[nid] = { ...parent, children: remaining };
        }
      });
      commit({
        ...tree,
        rootIds: tree.rootIds.filter((r) => r !== id),
        nodes,
        links: (tree.links ?? []).filter(
          (l) => !idSet.has(l.from) && !idSet.has(l.to)
        ),
      });
      setSelectedId(null);
      setEditingId(null);
      setConfirmDeleteId(null);
    },
    [tree, commit, collectSubtree]
  );

  const requestDelete = React.useCallback(
    (id: string) => {
      const node = tree.nodes[id];
      if (!node) {
        return;
      }
      if (node.children.length > 0) {
        setConfirmDeleteId(id);
      } else {
        deleteNode(id);
      }
    },
    [tree, deleteNode]
  );

  const removeLink = React.useCallback(
    (linkId: string) => {
      commit({
        ...tree,
        links: (tree.links ?? []).filter((l) => l.id !== linkId),
      });
    },
    [tree, commit]
  );

  /** Commits a hierarchy move and brings the moved node into view. */
  const moveLevel = React.useCallback(
    (next: TreeData | null, id: string) => {
      if (!next) {
        return;
      }
      revealRef.current = id;
      setLinkMenu(null);
      commit(next);
    },
    [commit]
  );

  // ---- automatic layout: returning pinned nodes to their slots ------------

  /** Tree where `id` and its children block are laid out automatically. */
  const autoPlacedTree = React.useCallback(
    (id: string): TreeData | null => {
      const node = tree.nodes[id];
      if (!node || !isPinned(node)) {
        return null;
      }
      return { ...tree, nodes: { ...tree.nodes, [id]: unpin(node) } };
    },
    [tree]
  );

  /**
   * Tree where every descendant of `id` is laid out automatically under it.
   * The node itself keeps its own pin so it does not move.
   */
  const tidiedBranchTree = React.useCallback(
    (id: string): TreeData | null => {
      const node = tree.nodes[id];
      if (!node) {
        return null;
      }
      const nodes = { ...tree.nodes, [id]: unpinChildren(node) };
      let changed = !!node.childrenOffset;
      collectSubtree(id, []).forEach((nid) => {
        if (nid !== id && nodes[nid] && isPinned(nodes[nid])) {
          nodes[nid] = unpin(nodes[nid]);
          changed = true;
        }
      });
      return changed ? { ...tree, nodes } : null;
    },
    [tree, collectSubtree]
  );

  /** Tree where every node is laid out automatically. */
  const tidiedAllTree = React.useMemo((): TreeData | null => {
    const nodes: Record<string, TreeNode> = {};
    let changed = false;
    Object.values(tree.nodes).forEach((n) => {
      if (isPinned(n)) {
        changed = true;
      }
      nodes[n.id] = unpin(n);
    });
    return changed ? { ...tree, nodes } : null;
  }, [tree]);

  const pendingFitRef = React.useRef(false);

  // Hovering a tidy action previews the layout it would produce (ghost
  // rectangles at every node that would move), so the user sees what the
  // explicit click will do before anything moves.
  const [previewTree, setPreviewTree] = React.useState<TreeData | null>(null);
  const previewPositions = React.useMemo(
    () => (previewTree ? computeLayout(previewTree).positions : null),
    [previewTree]
  );
  // A preview is derived from the tree it was computed for; drop it as soon
  // as the tree changes underneath (undo, autosave race) so no stale ghosts
  // linger until the pointer leaves the control.
  React.useEffect(() => {
    setPreviewTree(null);
  }, [tree]);

  const [snapEnabled, setSnapEnabled] = React.useState(true);
  const snapEnabledRef = React.useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;

  // ---- pan / zoom ----------------------------------------------------------

  const containerRef = React.useRef<HTMLDivElement>(null);
  const fillHeight = useFillViewportHeight(containerRef);
  const [view, setView] = React.useState({ x: 40, y: 40, scale: 1 });
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const startPan = React.useCallback((e: React.PointerEvent) => {
    const start = {
      x: e.clientX,
      y: e.clientY,
      ox: viewRef.current.x,
      oy: viewRef.current.y,
    };
    const move = (ev: PointerEvent) => {
      setView((v) => ({
        ...v,
        x: start.ox + (ev.clientX - start.x),
        y: start.oy + (ev.clientY - start.y),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    // Right-drag pans the camera from anywhere on the canvas (nodes let
    // right-clicks bubble up to here).
    if (e.button === 2) {
      startPan(e);
      return;
    }
    if (e.button !== 0) {
      return;
    }
    // Left-drag on empty background also pans, and clears the selection.
    setSelectedId(null);
    setEditingId(null);
    setLinkMenu(null);
    startPan(e);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      setView((v) => ({
        ...v,
        x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: v.y - (e.shiftKey ? 0 : e.deltaY),
      }));
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({
      ...v,
      scale: Math.min(2.5, Math.max(0.15, v.scale * factor)),
    }));
  };

  const zoomBy = (factor: number) =>
    setView((v) => ({
      ...v,
      scale: Math.min(2.5, Math.max(0.15, v.scale * factor)),
    }));

  const { positions, bounds } = React.useMemo(
    () => computeLayout(tree),
    [tree]
  );
  const svgW = Math.max(1, bounds.maxX + NODE_W + 400);
  const svgH = Math.max(1, bounds.maxY + NODE_H + 400);

  const fitToView = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const bw = bounds.maxX - bounds.minX + NODE_W + 80;
    const bh = bounds.maxY - bounds.minY + NODE_H + 80;
    const scale = Math.max(0.15, Math.min(vw / bw, vh / bh, 1) * 0.95);
    setView({
      x: (vw - bw * scale) / 2 - (bounds.minX - 40) * scale,
      y: (vh - bh * scale) / 2 - (bounds.minY - 40) * scale,
      scale,
    });
  }, [bounds]);

  // Frame the camera on the content once at open. This replaces the old layout
  // normalization: nodes keep their absolute positions, only the camera moves,
  // so existing trees are always discoverable wherever they were dragged.
  // Framing waits for the measured height, otherwise it would be computed
  // against the CSS fallback and could leave the lowest nodes cut off.
  const framedRef = React.useRef(false);
  React.useEffect(() => {
    if (!framedRef.current && fillHeight !== undefined) {
      framedRef.current = true;
      fitToView();
    }
  }, [fitToView, fillHeight]);

  // "Tidy all" is the one tidy action allowed to move the camera: it refits
  // once the new layout is known.
  React.useEffect(() => {
    if (pendingFitRef.current) {
      pendingFitRef.current = false;
      fitToView();
    }
  }, [tree, fitToView]);

  // When a node enters edit mode (e.g. it was just created off-screen, like a
  // new tree stacked below the others), pan the camera just enough to reveal
  // it — the nodes themselves never move.
  const revealRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // A node just moved in its hierarchy is revealed the same way.
    const target = revealRef.current ?? editingId;
    revealRef.current = null;
    if (!target) {
      return;
    }
    const p = positions[target];
    const el = containerRef.current;
    if (!p || !el) {
      return;
    }
    const v = viewRef.current;
    const sx = p.x * v.scale + v.x;
    const sy = p.y * v.scale + v.y;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const margin = 40;
    let dx = 0;
    let dy = 0;
    if (sx < margin) {
      dx = margin - sx;
    } else if (sx + NODE_W * v.scale > vw - margin) {
      dx = vw - margin - (sx + NODE_W * v.scale);
    }
    if (sy < margin) {
      dy = margin - sy;
    } else if (sy + NODE_H * v.scale > vh - margin) {
      dy = vh - margin - (sy + NODE_H * v.scale);
    }
    if (dx || dy) {
      setView((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    }
  }, [editingId, positions]);

  // World coords from a screen event.
  const toWorld = React.useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: ((clientX - (rect?.left ?? 0)) - v.x) / v.scale,
      y: ((clientY - (rect?.top ?? 0)) - v.y) / v.scale,
    };
  }, []);

  // ---- moving a node's sub-tree -------------------------------------------

  const [drag, setDrag] = React.useState<{
    subtree: Set<string>;
    dx: number;
    dy: number;
    /** Vertical alignment guide (world coords) when snapped on X. */
    guideX?: { x: number; y1: number; y2: number };
    /** Horizontal alignment guide (world coords) when snapped on Y. */
    guideY?: { y: number; x1: number; x2: number };
    /** Where the dragged node would sit under the automatic layout. */
    tidySlot?: Point;
    /** True while the node is snapped onto its automatic slot. */
    atAuto?: boolean;
  } | null>(null);

  // Map each node to its tree-parent (children arrays only).
  const parentOf = React.useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(tree.nodes).forEach((n) =>
      n.children.forEach((c) => {
        map[c] = n.id;
      })
    );
    return map;
  }, [tree]);

  /**
   * Left-drag on a node moves it alone; Shift+left-drag moves it with its
   * whole sub-tree (children and manual-link targets). A plain click (below
   * the 4px drag threshold) only selects. Right-drag pans the camera and is
   * handled at the viewport level.
   */
  const onNodePointerDown = React.useCallback(
    (id: string, e: React.PointerEvent) => {
      if (e.button !== 0) {
        // Let right-clicks bubble up to the viewport for camera panning.
        return;
      }
      e.stopPropagation();
      setSelectedId(id);
      setLinkMenu(null);
      if (readOnly) {
        return;
      }

      const withSubtree = e.shiftKey;
      const moved = new Set<string>();
      if (withSubtree) {
        // Sub-tree plus everything reachable by following manual links in the
        // direction of their arrow (cycle-safe).
        const stack = [id];
        while (stack.length) {
          const cur = stack.pop() as string;
          if (moved.has(cur) || !tree.nodes[cur]) {
            continue;
          }
          moved.add(cur);
          tree.nodes[cur].children.forEach((c) => stack.push(c));
          (tree.links ?? []).forEach((l) => {
            if (l.from === cur) {
              stack.push(l.to);
            }
          });
        }
      } else {
        moved.add(id);
      }

      const origin = positions[id];
      if (!origin) {
        return;
      }
      const startX = e.clientX;
      const startY = e.clientY;
      // Deltas are measured in world units so panning or zooming mid-drag
      // never desynchronises the node from the pointer.
      const startWorld = toWorld(startX, startY);

      // Snap candidates are built once: every node that stays put offers its
      // column (left edge), the "child column" to its right and the "parent
      // column" to its left, plus its row and the rows directly above/below
      // it at the standard stacking gap. The node's own automatic slot (where
      // the tidy layout would put it) is offered too, so dragging it back
      // near home snaps it exactly onto the auto layout.
      const candX: SnapCandidate[] = [];
      const candY: SnapCandidate[] = [];
      const seenX = new Set<number>();
      const seenY = new Set<number>();
      const pushX = (c: SnapCandidate) => {
        const k = Math.round(c.v * 2);
        if (!seenX.has(k)) {
          seenX.add(k);
          candX.push(c);
        }
      };
      const pushY = (c: SnapCandidate) => {
        const k = Math.round(c.v * 2);
        if (!seenY.has(k)) {
          seenY.add(k);
          candY.push(c);
        }
      };
      const own = tree.nodes[id].offset ?? { x: 0, y: 0 };
      const parentId = parentOf[id];
      const tidySlot =
        parentId && moved.has(parentId)
          ? undefined
          : { x: origin.x - own.x, y: origin.y - own.y };
      if (tidySlot) {
        const src = parentId ? positions[parentId] ?? tidySlot : tidySlot;
        pushX({ v: tidySlot.x, src, tidy: true });
        pushY({ v: tidySlot.y, src, tidy: true });
      }
      const stationary: Point[] = [];
      Object.keys(positions).forEach((nid) => {
        if (moved.has(nid)) {
          return;
        }
        const p = positions[nid];
        stationary.push(p);
        pushX({ v: p.x, src: p });
        pushX({ v: p.x + NODE_W + H_GAP, src: p });
        pushX({ v: p.x - NODE_W - H_GAP, src: p });
        pushY({ v: p.y, src: p });
        pushY({ v: p.y + NODE_H + V_GAP, src: p });
        pushY({ v: p.y - NODE_H - V_GAP, src: p });
      });
      const overlaps = (x: number, y: number) =>
        stationary.some((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);

      let dragging = false;
      // Last applied (possibly snapped) delta, reused on release.
      let last = { dx: 0, dy: 0 };
      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", onKey);
        setDrag(null);
      };
      const move = (ev: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4
        ) {
          dragging = true;
        }
        if (!dragging) {
          return;
        }
        const scale = viewRef.current.scale;
        const cur = toWorld(ev.clientX, ev.clientY);
        let dx = cur.x - startWorld.x;
        let dy = cur.y - startWorld.y;
        let guideX: { x: number; y1: number; y2: number } | undefined;
        let guideY: { y: number; x1: number; x2: number } | undefined;
        let atAuto = false;
        // Alt or Ctrl held during the drag disables snapping for free placement.
        const snapping =
          snapEnabledRef.current && !ev.altKey && !ev.ctrlKey && !ev.metaKey;
        if (snapping) {
          const tx = origin.x + dx;
          const ty = origin.y + dy;
          const tolAuto = SNAP_AUTO_PX / scale;
          if (
            tidySlot &&
            Math.abs(tx - tidySlot.x) <= tolAuto &&
            Math.abs(ty - tidySlot.y) <= tolAuto
          ) {
            // Two-axis capture by the automatic slot.
            dx = tidySlot.x - origin.x;
            dy = tidySlot.y - origin.y;
            atAuto = true;
          } else {
            const thr = SNAP_PX / scale;
            let sx = snapAxis(tx, candX, thr);
            let sy = snapAxis(ty, candY, thr);
            // Never snap exactly on top of another node: release the axis
            // that had to travel further to get there.
            if (sx && sy && overlaps(sx.v, sy.v)) {
              if (Math.abs(sx.v - tx) > Math.abs(sy.v - ty)) {
                sx = null;
              } else {
                sy = null;
              }
            }
            if (sx) {
              dx = sx.v - origin.x;
            }
            if (sy) {
              dy = sy.v - origin.y;
            }
            const nx = origin.x + dx;
            const ny = origin.y + dy;
            if (sx) {
              guideX = {
                x: sx.v,
                y1: Math.min(sx.src.y, ny) - 24,
                y2: Math.max(sx.src.y + NODE_H, ny + NODE_H) + 24,
              };
            }
            if (sy) {
              guideY = {
                y: sy.v,
                x1: Math.min(sy.src.x, nx) - 24,
                x2: Math.max(sy.src.x + NODE_W, nx + NODE_W) + 24,
              };
            }
          }
        }
        last = { dx, dy };
        setDrag({ subtree: moved, dx, dy, guideX, guideY, tidySlot, atAuto });
      };
      const up = () => {
        cleanup();
        if (!dragging) {
          return;
        }
        const { dx, dy } = last;
        if (!dx && !dy) {
          return;
        }
        // Apply the move on top of whatever the tree is NOW, so a commit that
        // landed during the drag (text blur, undo) is preserved. The moved
        // set was computed at pointer-down, hence the existence guards.
        const base = treeRef.current;
        const nodes = { ...base.nodes };
        if (withSubtree) {
          // Offset every "root" of the moved region — nodes whose tree-parent
          // did not move. Their descendants follow via the cumulative layout.
          moved.forEach((nid) => {
            const parent = parentOf[nid];
            if (!nodes[nid] || (parent && moved.has(parent))) {
              return;
            }
            nodes[nid] = shiftOffset(nodes[nid], dx, dy);
          });
        } else if (nodes[id]) {
          // Move the node alone: pin it, and displace its children block the
          // opposite way so the children stay exactly where they were while
          // remaining automatic among themselves. Hidden (collapsed) children
          // follow the node instead, so they are never left behind unseen.
          nodes[id] = shiftOffset(nodes[id], dx, dy);
          if (nodes[id].children.length && !nodes[id].collapsed) {
            nodes[id] = shiftField(nodes[id], "childrenOffset", -dx, -dy);
          }
        } else {
          return;
        }
        commit({ ...base, nodes });
      };
      const onKey = (ev: KeyboardEvent) => {
        // Escape abandons the drag without committing anything.
        if (ev.key === "Escape") {
          dragging = false;
          cleanup();
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("keydown", onKey);
    },
    [tree, positions, parentOf, commit, readOnly, toWorld]
  );

  // ---- creating a manual link ---------------------------------------------

  const [linking, setLinking] = React.useState<{
    from: string;
    fromSide: Side;
  } | null>(null);
  const [linkCursor, setLinkCursor] = React.useState<Point | null>(null);

  // Small contextual menu opened by clicking an arrow, to delete it safely
  // instead of removing it on a bare click. Coordinates are viewport-relative.
  // It targets either a manual link (deletable) or a parent-to-child arrow
  // (detachable): both look the same on the canvas, so both must respond.
  const [linkMenu, setLinkMenu] = React.useState<{
    linkId?: string;
    edge?: { from: string; to: string };
    x: number;
    y: number;
  } | null>(null);

  const openArrowMenu = (
    e: React.PointerEvent,
    target: { linkId?: string; edge?: { from: string; to: string } }
  ) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    // Offset below the cursor so the menu doesn't sit right under the
    // pointer, which invited accidental clicks.
    setLinkMenu({
      ...target,
      x: e.clientX - (rect?.left ?? 0) - 20,
      y: e.clientY - (rect?.top ?? 0) + 28,
    });
  };

  const startLink = React.useCallback(
    (id: string, side: Side, e: React.PointerEvent) => {
      if (e.button !== 0) {
        // Let right-clicks bubble up for camera panning.
        return;
      }
      e.stopPropagation();
      setLinking({ from: id, fromSide: side });
      setLinkCursor(toWorld(e.clientX, e.clientY));
      const move = (ev: PointerEvent) => {
        setLinkCursor(toWorld(ev.clientX, ev.clientY));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const target = window.document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest("[data-handle]") as HTMLElement | null;
        const toId = target?.getAttribute("data-node") ?? undefined;
        const toSide = target?.getAttribute("data-side") as Side | undefined;
        setLinking(null);
        setLinkCursor(null);
        const current = treeRef.current;
        const existing = current.links ?? [];
        if (
          toId &&
          toSide &&
          toId !== id &&
          !existing.some(
            (l) =>
              l.from === id &&
              l.to === toId &&
              l.fromSide === side &&
              l.toSide === toSide
          )
        ) {
          commit({
            ...current,
            links: [
              ...existing,
              { id: uid(), from: id, fromSide: side, to: toId, toSide },
            ],
          });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [toWorld, commit]
  );

  // ---- keyboard: undo / redo ----------------------------------------------

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (readOnly) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [readOnly, undo, redo]);

  // ---- render --------------------------------------------------------------

  const bg = tree.bgColor || DEFAULT_BG;
  const arrowStyle: "elbow" | "curved" = tree.arrowStyle ?? "elbow";
  // The whole world is zoomed with a CSS transform, which SVG's
  // non-scaling-stroke cannot undo; overlay strokes are divided by the zoom
  // so guides keep a constant on-screen thickness.
  const k = 1 / view.scale;
  const visibleIds = Object.keys(positions);
  const posOf = (id: string): Point => {
    const p = positions[id];
    if (drag && drag.subtree.has(id)) {
      return { x: p.x + drag.dx, y: p.y + drag.dy };
    }
    return p;
  };

  const treeEdges: Array<{ from: string; to: string }> = [];
  visibleIds.forEach((id) => {
    const node = tree.nodes[id];
    if (!node || node.collapsed) {
      return;
    }
    node.children.forEach((c) => {
      if (positions[c]) {
        treeEdges.push({ from: id, to: c });
      }
    });
  });

  const links = (tree.links ?? []).filter(
    (l) => positions[l.from] && positions[l.to]
  );

  return (
    <Viewport
      ref={containerRef}
      tabIndex={0}
      style={{ background: bg, height: fillHeight }}
      onPointerDown={onBackgroundPointerDown}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
    >
      <World
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          width: svgW,
          height: svgH,
        }}
      >
        <Edges width={svgW} height={svgH}>
          <defs>
            <marker
              id="tree-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.5)" />
            </marker>
          </defs>

          {treeEdges.map(({ from, to }) => {
            const pa = posOf(from);
            const pb = posOf(to);
            const { aSide, bSide } = pickSides(pa, pb);
            const d = routeEdge(pa, aSide, pb, bSide, arrowStyle);
            const active =
              linkMenu?.edge?.from === from && linkMenu?.edge?.to === to;
            return (
              <g key={`e-${from}-${to}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={
                    active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)"
                  }
                  strokeWidth={2}
                  markerEnd="url(#tree-arrow)"
                />
                {!readOnly && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onPointerDown={(e) =>
                      openArrowMenu(e, { edge: { from, to } })
                    }
                  />
                )}
              </g>
            );
          })}

          {links.map((l) => {
            const pa = posOf(l.from);
            const pb = posOf(l.to);
            const sides = effectiveSides(pa, l.fromSide, pb, l.toSide);
            const d = routeEdge(pa, sides.aSide, pb, sides.bSide, arrowStyle);
            const active = !!linkMenu && linkMenu.linkId === l.id;
            return (
              <g key={`l-${l.id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={
                    active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)"
                  }
                  strokeWidth={2}
                  markerEnd="url(#tree-arrow)"
                />
                {!readOnly && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onPointerDown={(e) => openArrowMenu(e, { linkId: l.id })}
                  />
                )}
              </g>
            );
          })}

          {/* Ghost of the dragged node's automatic slot; fills when captured. */}
          {drag?.tidySlot && (
            <rect
              x={drag.tidySlot.x}
              y={drag.tidySlot.y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill={GUIDE_COLOR}
              fillOpacity={drag.atAuto ? 0.18 : 0}
              stroke={GUIDE_COLOR}
              strokeOpacity={drag.atAuto ? 0.9 : 0.45}
              strokeWidth={(drag.atAuto ? 2 : 1.5) * k}
              strokeDasharray={`${6 * k} ${4 * k}`}
            />
          )}
          {/* Alignment guides: a dark halo under a dashed line so they read on
              any background colour. */}
          {drag?.guideX &&
            [
              { stroke: "rgba(0,0,0,0.35)", w: 3, dashed: false },
              { stroke: GUIDE_COLOR, w: 1.5, dashed: true },
            ].map((s, i) => (
              <line
                key={`gx-${i}`}
                x1={drag.guideX!.x}
                y1={drag.guideX!.y1}
                x2={drag.guideX!.x}
                y2={drag.guideX!.y2}
                stroke={s.stroke}
                strokeWidth={s.w * k}
                strokeDasharray={s.dashed ? `${4 * k} ${4 * k}` : undefined}
              />
            ))}
          {drag?.guideY &&
            [
              { stroke: "rgba(0,0,0,0.35)", w: 3, dashed: false },
              { stroke: GUIDE_COLOR, w: 1.5, dashed: true },
            ].map((s, i) => (
              <line
                key={`gy-${i}`}
                x1={drag.guideY!.x1}
                y1={drag.guideY!.y}
                x2={drag.guideY!.x2}
                y2={drag.guideY!.y}
                stroke={s.stroke}
                strokeWidth={s.w * k}
                strokeDasharray={s.dashed ? `${4 * k} ${4 * k}` : undefined}
              />
            ))}
          {/* Preview of a hovered tidy action: where each node would move. */}
          {previewPositions &&
            Object.keys(previewPositions).map((nid) => {
              const from = positions[nid];
              const to = previewPositions[nid];
              if (!from || Math.hypot(to.x - from.x, to.y - from.y) < 1) {
                return null;
              }
              return (
                <rect
                  key={`pv-${nid}`}
                  x={to.x}
                  y={to.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={GUIDE_COLOR}
                  fillOpacity={0.1}
                  stroke={GUIDE_COLOR}
                  strokeOpacity={0.6}
                  strokeWidth={1.5 * k}
                  strokeDasharray={`${6 * k} ${4 * k}`}
                />
              );
            })}

          {linking && linkCursor && positions[linking.from] && (
            <path
              d={(() => {
                const a = anchor(posOf(linking.from), linking.fromSide);
                const c1 = control(a, linking.fromSide);
                return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${linkCursor.x} ${linkCursor.y} ${linkCursor.x} ${linkCursor.y}`;
              })()}
              fill="none"
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={2}
              strokeDasharray="6 4"
              markerEnd="url(#tree-arrow)"
            />
          )}
        </Edges>

        {visibleIds.map((id) => {
          const node = tree.nodes[id];
          const p = posOf(id);
          const isSelected = selectedId === id;
          const isEditing = editingId === id;
          const showHandles =
            !readOnly && !drag && (hoveredId === id || linking !== null);
          const hasChildren = node.children.length > 0;
          // The dragged node paints over its ghost slot, so the capture by the
          // automatic slot is signalled on the node itself.
          const capturedByAuto = !!drag?.atAuto && drag.subtree.has(id);
          return (
            <NodePositioner
              key={id}
              style={{ left: p.x, top: p.y }}
              onMouseEnter={() => setHoveredId(id)}
              onMouseLeave={() =>
                setHoveredId((cur) => (cur === id ? null : cur))
              }
            >
              <NodeBox
                style={{
                  width: NODE_W,
                  height: NODE_H,
                  background: nodeColor(node),
                  outline: capturedByAuto
                    ? `2px solid ${GUIDE_COLOR}`
                    : isSelected
                      ? "2px solid #ffffff"
                      : "none",
                  boxShadow: capturedByAuto
                    ? "0 0 0 5px rgba(143,179,255,0.35), 0 2px 8px rgba(0,0,0,0.35)"
                    : undefined,
                }}
                onPointerDown={(e) => onNodePointerDown(id, e)}
                onDoubleClick={() => !readOnly && setEditingId(id)}
              >
                {node.emoji ? <Emoji>{node.emoji}</Emoji> : null}
                {isEditing ? (
                  <NodeInput
                    autoFocus
                    defaultValue={node.text}
                    onBlur={(e) => {
                      updateNode(id, { text: e.target.value });
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        setEditingId(null);
                      }
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <NodeText>{node.text || t("Untitled")}</NodeText>
                )}
              </NodeBox>

              {!readOnly && isPinned(node) && (
                <PinBadge
                  title={
                    node.offset
                      ? t(
                          "Placed by hand. Click to return to the automatic position"
                        )
                      : t(
                          "Children placed by hand. Click to return them to the automatic layout"
                        )
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() =>
                    !drag && setPreviewTree(autoPlacedTree(id))
                  }
                  onMouseLeave={() => setPreviewTree(null)}
                  onClick={() => {
                    const next = autoPlacedTree(id);
                    setPreviewTree(null);
                    if (next) {
                      commit(next);
                    }
                  }}
                />
              )}

              {showHandles &&
                (["top", "bottom", "left", "right"] as Side[]).map((side) => (
                  <Handle
                    key={side}
                    data-handle="true"
                    data-node={id}
                    data-side={side}
                    $side={side}
                    title={t("Drag to link")}
                    onPointerDown={(e) => startLink(id, side, e)}
                  />
                ))}

              {isSelected && !readOnly && (
                <Toolbar onPointerDown={(e) => e.stopPropagation()}>
                  <StatusRow>
                    {STATUS_ORDER.map((s) => (
                      <Swatch
                        key={s}
                        title={t(STATUSES[s].labelKey)}
                        style={{
                          background: STATUSES[s].color,
                          outline:
                            !node.color && node.status === s
                              ? "2px solid #fff"
                              : "1px solid rgba(255,255,255,0.3)",
                        }}
                        onClick={() =>
                          updateNode(id, { status: s, color: undefined })
                        }
                      />
                    ))}
                  </StatusRow>
                  <ColorInput
                    type="color"
                    title={t("Custom color")}
                    value={nodeColor(node)}
                    onChange={(e) => updateNode(id, { color: e.target.value })}
                  />
                  <Btn title={t("Add child")} onClick={() => addChild(id)}>
                    +
                  </Btn>
                  <Btn
                    title={t("Move up one level")}
                    disabled={!promotedTree(tree, id)}
                    onClick={() => moveLevel(promotedTree(tree, id), id)}
                  >
                    ←
                  </Btn>
                  <Btn
                    title={t("Move down one level")}
                    disabled={!demotedTree(tree, id)}
                    onClick={() => moveLevel(demotedTree(tree, id), id)}
                  >
                    →
                  </Btn>
                  {hasChildren && (
                    <Btn
                      title={node.collapsed ? t("Expand") : t("Collapse")}
                      onClick={() =>
                        updateNode(id, { collapsed: !node.collapsed })
                      }
                    >
                      {node.collapsed ? "▸" : "–"}
                    </Btn>
                  )}
                  <Btn
                    title={
                      tidiedBranchTree(id)
                        ? t("Tidy branch")
                        : hasChildren
                          ? t(
                              "Tidy branch: no child of this node was placed by hand"
                            )
                          : t(
                              "Tidy branch: this node has no children (manual links are not children)"
                            )
                    }
                    disabled={!tidiedBranchTree(id)}
                    onMouseEnter={() =>
                      !drag && setPreviewTree(tidiedBranchTree(id))
                    }
                    onMouseLeave={() => setPreviewTree(null)}
                    onClick={() => {
                      const next = tidiedBranchTree(id);
                      setPreviewTree(null);
                      if (next) {
                        commit(next);
                      }
                    }}
                  >
                    ⟲
                  </Btn>
                  <Btn
                    title={t("Delete")}
                    $danger
                    onClick={() => requestDelete(id)}
                  >
                    🗑
                  </Btn>
                </Toolbar>
              )}
            </NodePositioner>
          );
        })}
      </World>

      {linkMenu && !readOnly && (
        <LinkMenu
          style={{ left: linkMenu.x, top: linkMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {linkMenu.linkId ? (
            <Btn
              $danger
              onClick={() => {
                if (linkMenu.linkId) {
                  removeLink(linkMenu.linkId);
                }
                setLinkMenu(null);
              }}
            >
              🗑 {t("Delete")}
            </Btn>
          ) : (
            <Btn
              $danger
              title={t(
                "Cut this arrow: the node becomes a separate tree and stays where it is"
              )}
              onClick={() => {
                // The hierarchy may have changed while the menu was open:
                // only cut the arrow that was actually clicked.
                const edge = linkMenu.edge;
                const next =
                  edge && findParent(tree, edge.to) === edge.from
                    ? detachedTree(tree, edge.to)
                    : null;
                setLinkMenu(null);
                if (next) {
                  commit(next);
                }
              }}
            >
              ✂ {t("Detach")}
            </Btn>
          )}
          <Btn onClick={() => setLinkMenu(null)}>{t("Cancel")}</Btn>
        </LinkMenu>
      )}

      {!readOnly && (
        <Controls onPointerDown={(e) => e.stopPropagation()}>
          <Btn title={t("New tree")} onClick={addRoot}>
            + {t("Tree")}
          </Btn>
          <Divider />
          <Btn title={t("Zoom in")} onClick={() => zoomBy(1.2)}>
            +
          </Btn>
          <Btn title={t("Zoom out")} onClick={() => zoomBy(1 / 1.2)}>
            −
          </Btn>
          <Btn title={t("Fit to view")} onClick={fitToView}>
            ⤢
          </Btn>
          <Divider />
          <Btn
            title={t("Tidy all")}
            disabled={!tidiedAllTree}
            onMouseEnter={() => !drag && setPreviewTree(tidiedAllTree)}
            onMouseLeave={() => setPreviewTree(null)}
            onClick={() => {
              if (tidiedAllTree) {
                setPreviewTree(null);
                pendingFitRef.current = true;
                commit(tidiedAllTree);
              }
            }}
          >
            ⊞
          </Btn>
          <Btn
            title={t(
              "Snap to guides (hold Alt or Ctrl while dragging to bypass; Esc cancels a drag)"
            )}
            $active={snapEnabled}
            onClick={() => setSnapEnabled((v) => !v)}
          >
            ⌖
          </Btn>
          <Divider />
          <Btn
            title={t("Arrow style")}
            onClick={() =>
              commit({
                ...tree,
                arrowStyle: arrowStyle === "elbow" ? "curved" : "elbow",
              })
            }
          >
            {arrowStyle === "elbow" ? "⌐" : "∿"}
          </Btn>
          <ColorInput
            type="color"
            title={t("Background color")}
            value={bg}
            onChange={(e) => commit({ ...tree, bgColor: e.target.value })}
          />
        </Controls>
      )}

      {confirmDeleteId && (
        <ConfirmOverlay onPointerDown={(e) => e.stopPropagation()}>
          <ConfirmBox>
            <p>
              {t(
                "Delete this node and all of its children? This cannot be undone."
              )}
            </p>
            <ConfirmActions>
              <Btn onClick={() => setConfirmDeleteId(null)}>{t("Cancel")}</Btn>
              <Btn $danger onClick={() => deleteNode(confirmDeleteId)}>
                {t("Delete")}
              </Btn>
            </ConfirmActions>
          </ConfirmBox>
        </ConfirmOverlay>
      )}
    </Viewport>
  );
}

/**
 * Wrapper that loads the scene straight from the server before mounting the
 * editor, so it always initializes from the latest saved data rather than a
 * stale cached model.
 */
function TreeEditor({ document, readOnly }: Props) {
  const [initialTree, setInitialTree] = React.useState<TreeData | undefined>(
    undefined
  );

  React.useEffect(() => {
    let cancelled = false;
    void client
      .post("/documents.info", { id: document.id })
      // oxlint-disable-next-line no-explicit-any
      .then((res: any) => {
        if (cancelled) {
          return;
        }
        const doc = res?.data?.document ?? res?.data;
        setInitialTree(normalize(doc?.canvasData) ?? defaultTree());
      })
      .catch(() => {
        if (!cancelled) {
          setInitialTree(defaultTree());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  if (!initialTree) {
    return <Viewport style={{ background: DEFAULT_BG }} />;
  }
  return (
    <TreeEditorInner
      document={document}
      readOnly={readOnly}
      initialTree={initialTree}
    />
  );
}

const Viewport = styled.div`
  position: relative;
  width: 100%;
  height: calc(100vh - 68px);
  min-height: 320px;
  overflow: hidden;
  outline: none;
  cursor: grab;
  touch-action: none;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
`;

const World = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
`;

const Edges = styled.svg`
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
`;

const NodePositioner = styled.div`
  position: absolute;
`;

const NodeBox = styled.div`
  position: relative;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
  color: #ffffff;
  font-weight: 600;
`;

const Handle = styled.div<{ $side: Side }>`
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #8fb3ff;
  border: 2px solid #1b211f;
  cursor: crosshair;
  z-index: 2;
  ${(p) =>
    p.$side === "top" &&
    "top: -9px; left: 50%; transform: translateX(-50%);"}
  ${(p) =>
    p.$side === "bottom" &&
    "bottom: -9px; left: 50%; transform: translateX(-50%);"}
  ${(p) =>
    p.$side === "left" && "left: -9px; top: 50%; transform: translateY(-50%);"}
  ${(p) =>
    p.$side === "right" &&
    "right: -9px; top: 50%; transform: translateY(-50%);"}

  &:hover {
    background: #ffffff;
  }
`;

const Emoji = styled.span`
  font-size: 18px;
  flex-shrink: 0;
`;

const NodeText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NodeInput = styled.input`
  width: 100%;
  border: none;
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
  font-weight: 600;
  border-radius: 4px;
  padding: 4px 6px;
  outline: none;
`;

const Toolbar = styled.div`
  position: absolute;
  top: -44px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #2b2f2d;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  z-index: 3;
`;

const StatusRow = styled.div`
  display: flex;
  gap: 3px;
`;

const Swatch = styled.button`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: none;
  padding: 0;
  cursor: pointer;
`;

const ColorInput = styled.input`
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
`;

const Btn = styled.button<{ $danger?: boolean; $active?: boolean }>`
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  border: none;
  background: ${(p) =>
    p.$danger
      ? "rgba(200,60,60,0.25)"
      : p.$active
        ? "rgba(143,179,255,0.35)"
        : "rgba(255,255,255,0.1)"};
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;

  &:hover {
    background: ${(p) =>
      p.$danger
        ? "rgba(200,60,60,0.5)"
        : p.$active
          ? "rgba(143,179,255,0.5)"
          : "rgba(255,255,255,0.2)"};
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &:disabled:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

/* Deliberately unlike the round blue link handles: a small amber square. */
const PinBadge = styled.div`
  position: absolute;
  top: -6px;
  right: -6px;
  width: 13px;
  height: 13px;
  border-radius: 3px;
  background: #f5b942;
  border: 1px solid #1b211f;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  z-index: 2;

  &:hover {
    background: #ffffff;
  }
`;

const LinkMenu = styled.div`
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #2b2f2d;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  z-index: 6;
`;

const Controls = styled.div`
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #2b2f2d;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  z-index: 5;
`;

const Divider = styled.span`
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
`;

const ConfirmOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
`;

const ConfirmBox = styled.div`
  background: #2b2f2d;
  color: #fff;
  border-radius: 10px;
  padding: 20px;
  max-width: 360px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
`;

const ConfirmActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

export default observer(TreeEditor);
