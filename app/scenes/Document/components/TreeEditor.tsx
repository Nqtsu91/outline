import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import type Document from "~/models/Document";
import { client } from "~/utils/ApiClient";
import useStores from "~/hooks/useStores";

/**
 * Project tree editor.
 *
 * An infinite, dark canvas that renders one or more self-aligning trees of
 * rectangular nodes connected by elbow arrows. Nodes carry text, a status color
 * and an optional custom color. On top of the auto-layout:
 *  - any node can be dragged freely (Move tool); it takes its own sub-tree with
 *    it while its parent stays put, and connections stretch live.
 *  - arbitrary links can be drawn between nodes via the four handles that appear
 *    when hovering a node; multiple links may target the same node.
 *
 * Supports pan/zoom, fit-to-view, undo/redo and autosave.
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
  /** Manual position offset; shifts the node and its whole sub-tree. */
  offset?: { x: number; y: number };
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
  const links = Array.isArray(d.links) ? d.links : [];
  if (Array.isArray(d.rootIds) && d.rootIds.length) {
    return {
      rootIds: d.rootIds,
      nodes: d.nodes,
      links,
      bgColor: d.bgColor,
      arrowStyle: d.arrowStyle,
    };
  }
  if (d.rootId && d.nodes[d.rootId]) {
    return {
      rootIds: [d.rootId],
      nodes: d.nodes,
      links,
      bgColor: d.bgColor,
      arrowStyle: d.arrowStyle,
    };
  }
  return null;
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
 * Picks the pair of node sides an edge should connect, based on the relative
 * position of the two nodes, so the arrow always enters the target from an
 * outer face and its head is never hidden behind the node.
 */
function pickSides(a: Point, b: Point): { aSide: Side; bSide: Side } {
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

  // Cumulative manual offsets.
  const cum: Positions = {};
  const walkCum = (id: string, px: number, py: number) => {
    const off = tree.nodes[id]?.offset ?? { x: 0, y: 0 };
    const x = px + off.x;
    const y = py + off.y;
    cum[id] = { x, y };
    tree.nodes[id]?.children.forEach((c) => walkCum(c, x, y));
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
  const [moveMode, setMoveMode] = React.useState(false);

  const history = React.useRef<TreeData[]>([tree]);
  const historyIndex = React.useRef(0);

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
      commit({
        ...tree,
        nodes: {
          ...tree.nodes,
          [child.id]: child,
          [parentId]: {
            ...parent,
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
          nodes[nid] = {
            ...nodes[nid],
            children: nodes[nid].children.filter((c) => !idSet.has(c)),
          };
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

  // ---- pan / zoom ----------------------------------------------------------

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ x: 40, y: 40, scale: 1 });
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    setSelectedId(null);
    setEditingId(null);
    const start = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
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
  const framedRef = React.useRef(false);
  React.useEffect(() => {
    if (!framedRef.current) {
      framedRef.current = true;
      fitToView();
    }
  }, [fitToView]);

  // When a node enters edit mode (e.g. it was just created off-screen, like a
  // new tree stacked below the others), pan the camera just enough to reveal
  // it — the nodes themselves never move.
  React.useEffect(() => {
    if (!editingId) {
      return;
    }
    const p = positions[editingId];
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

  const startNodeDrag = React.useCallback(
    (id: string, e: React.PointerEvent) => {
      // The moved region: the node's sub-tree plus everything reachable by
      // following manual links in the direction of their arrow (cycle-safe),
      // so linked nodes travel together like children do.
      const subtree = new Set<string>();
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop() as string;
        if (subtree.has(cur) || !tree.nodes[cur]) {
          continue;
        }
        subtree.add(cur);
        tree.nodes[cur].children.forEach((c) => stack.push(c));
        (tree.links ?? []).forEach((l) => {
          if (l.from === cur) {
            stack.push(l.to);
          }
        });
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev: PointerEvent) => {
        setDrag({
          subtree,
          dx: (ev.clientX - startX) / viewRef.current.scale,
          dy: (ev.clientY - startY) / viewRef.current.scale,
        });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const dx = (ev.clientX - startX) / viewRef.current.scale;
        const dy = (ev.clientY - startY) / viewRef.current.scale;
        setDrag(null);
        if (dx || dy) {
          // Offset every "root" of the moved region — nodes whose tree-parent
          // did not move. Their descendants follow via the cumulative layout.
          const nodes = { ...tree.nodes };
          subtree.forEach((nid) => {
            const parent = parentOf[nid];
            if (parent && subtree.has(parent)) {
              return;
            }
            const cur = nodes[nid].offset ?? { x: 0, y: 0 };
            nodes[nid] = {
              ...nodes[nid],
              offset: { x: cur.x + dx, y: cur.y + dy },
            };
          });
          commit({ ...tree, nodes });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [tree, parentOf, commit]
  );

  // ---- creating a manual link ---------------------------------------------

  const [linking, setLinking] = React.useState<{
    from: string;
    fromSide: Side;
  } | null>(null);
  const [linkCursor, setLinkCursor] = React.useState<Point | null>(null);

  const startLink = React.useCallback(
    (id: string, side: Side, e: React.PointerEvent) => {
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
        if (toId && toSide && toId !== id) {
          commit({
            ...tree,
            links: [
              ...(tree.links ?? []),
              { id: uid(), from: id, fromSide: side, to: toId, toSide },
            ],
          });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [toWorld, tree, commit]
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
      $move={moveMode}
      style={{ background: bg }}
      onPointerDown={onBackgroundPointerDown}
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
            return (
              <path
                key={`e-${from}-${to}`}
                d={routeEdge(pa, aSide, pb, bSide, arrowStyle)}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={2}
                markerEnd="url(#tree-arrow)"
              />
            );
          })}

          {links.map((l) => (
            <path
              key={`l-${l.id}`}
              d={routeEdge(
                posOf(l.from),
                l.fromSide,
                posOf(l.to),
                l.toSide,
                arrowStyle
              )}
              fill="none"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={2}
              markerEnd="url(#tree-arrow)"
              style={{
                pointerEvents: readOnly ? "none" : "stroke",
                cursor: "pointer",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!readOnly) {
                  removeLink(l.id);
                }
              }}
            />
          ))}

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
            !readOnly && !moveMode && (hoveredId === id || linking !== null);
          const hasChildren = node.children.length > 0;
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
                  outline: isSelected ? "2px solid #ffffff" : "none",
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (moveMode && !readOnly) {
                    startNodeDrag(id, e);
                  } else {
                    setSelectedId(id);
                  }
                }}
                onDoubleClick={() =>
                  !readOnly && !moveMode && setEditingId(id)
                }
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

              {isSelected && !readOnly && !moveMode && (
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

      {!readOnly && (
        <Controls onPointerDown={(e) => e.stopPropagation()}>
          <Btn
            title={t("Move tool")}
            style={
              moveMode ? { background: "rgba(120,160,255,0.5)" } : undefined
            }
            onClick={() => setMoveMode((m) => !m)}
          >
            ✋
          </Btn>
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

const Viewport = styled.div<{ $move?: boolean }>`
  position: relative;
  width: 100%;
  height: calc(100vh - 140px);
  min-height: 480px;
  overflow: hidden;
  outline: none;
  cursor: ${(p) => (p.$move ? "move" : "grab")};
  touch-action: none;
  user-select: none;

  &:active {
    cursor: ${(p) => (p.$move ? "move" : "grabbing")};
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

const Btn = styled.button<{ $danger?: boolean }>`
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  border: none;
  background: ${(p) =>
    p.$danger ? "rgba(200,60,60,0.25)" : "rgba(255,255,255,0.1)"};
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;

  &:hover {
    background: ${(p) =>
      p.$danger ? "rgba(200,60,60,0.5)" : "rgba(255,255,255,0.2)"};
  }
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
