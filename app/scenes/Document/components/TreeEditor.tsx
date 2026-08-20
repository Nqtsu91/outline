import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import type Document from "~/models/Document";
import { client } from "~/utils/ApiClient";
import useStores from "~/hooks/useStores";

/**
 * Project tree editor (MVP).
 *
 * An infinite, dark canvas that renders one or more self-aligning trees of
 * rectangular nodes connected by elbow arrows. Each node has text, a status
 * that colors the rectangle, and an optional custom color. Whole trees can be
 * moved freely (Move tool). Supports pan/zoom, fit-to-view, undo/redo and
 * autosave.
 *
 * Phase 2 (not yet implemented): drag a single branch to re-parent it with a
 * greyed preview and insertion onto connector arrows.
 */

type TreeStatus = "not_started" | "in_progress" | "to_validate" | "done";

type TreeNode = {
  id: string;
  text: string;
  emoji?: string;
  status: TreeStatus;
  /** Custom color override; takes precedence over the status color. */
  color?: string;
  collapsed?: boolean;
  children: string[];
  /** Manual position offset, only meaningful on root nodes (Move tool). */
  offset?: { x: number; y: number };
};

type TreeData = {
  rootIds: string[];
  nodes: Record<string, TreeNode>;
  bgColor?: string;
};

type Props = {
  document: Document;
  readOnly?: boolean;
};

const NODE_W = 190;
const NODE_H = 56;
const H_GAP = 72;
const V_GAP = 18;
const PADDING = 80;
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
  return { rootIds: [node.id], nodes: { [node.id]: node } };
}

function normalize(data: unknown): TreeData | null {
  let raw: unknown = data;
  // Some load paths may deliver canvasData as a JSON string rather than an
  // object — accept both.
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
  if (Array.isArray(d.rootIds) && d.rootIds.length) {
    return { rootIds: d.rootIds, nodes: d.nodes, bgColor: d.bgColor };
  }
  if (d.rootId && d.nodes[d.rootId]) {
    return { rootIds: [d.rootId], nodes: d.nodes, bgColor: d.bgColor };
  }
  return null;
}

type Positions = Record<string, { x: number; y: number }>;

/** Tidy left-to-right layout; children share a column, trees stack (or are moved). */
function computeLayout(tree: TreeData): {
  positions: Positions;
  width: number;
  height: number;
} {
  const raw: Positions = {};
  let leaf = 0;

  const walk = (id: string, depth: number, ox: number, oy: number): number => {
    const node = tree.nodes[id];
    if (!node) {
      return 0;
    }
    const x = ox + depth * (NODE_W + H_GAP);
    const kids = node.collapsed
      ? []
      : node.children.filter((c) => tree.nodes[c]);

    if (kids.length === 0) {
      const y = oy + leaf * (NODE_H + V_GAP);
      leaf++;
      raw[id] = { x, y };
      return y;
    }
    const ys = kids.map((cid) => walk(cid, depth + 1, ox, oy));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    raw[id] = { x, y };
    return y;
  };

  tree.rootIds.forEach((rootId) => {
    const root = tree.nodes[rootId];
    if (!root) {
      return;
    }
    const off = root.offset ?? { x: 0, y: 0 };
    walk(rootId, 0, off.x, off.y);
    leaf += TREE_GAP;
  });

  const xs = Object.values(raw).map((p) => p.x);
  const ys = Object.values(raw).map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;

  const positions: Positions = {};
  Object.keys(raw).forEach((id) => {
    positions[id] = {
      x: raw[id].x - minX + PADDING,
      y: raw[id].y - minY + PADDING,
    };
  });

  return {
    positions,
    width: maxX - minX + NODE_W + PADDING * 2,
    height: maxY - minY + NODE_H + PADDING * 2,
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

  // Guarantee the last edit is saved when navigating away.
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
      const nodes = { ...tree.nodes };
      ids.forEach((nid) => delete nodes[nid]);
      Object.keys(nodes).forEach((nid) => {
        if (nodes[nid].children.includes(id)) {
          nodes[nid] = {
            ...nodes[nid],
            children: nodes[nid].children.filter((c) => c !== id),
          };
        }
      });
      commit({
        ...tree,
        rootIds: tree.rootIds.filter((r) => r !== id),
        nodes,
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

  // Map each node to its owning root, for the Move tool.
  const nodeToRoot = React.useMemo(() => {
    const map: Record<string, string> = {};
    const assign = (id: string, root: string) => {
      map[id] = root;
      tree.nodes[id]?.children.forEach((c) => assign(c, root));
    };
    tree.rootIds.forEach((r) => assign(r, r));
    return map;
  }, [tree]);

  // ---- pan / zoom ----------------------------------------------------------

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ x: 40, y: 40, scale: 1 });
  const [drag, setDrag] = React.useState<{
    rootId: string;
    dx: number;
    dy: number;
  } | null>(null);

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

  const { positions, width, height } = React.useMemo(
    () => computeLayout(tree),
    [tree]
  );
  const scaleRef = React.useRef(view.scale);
  scaleRef.current = view.scale;

  const startTreeDrag = React.useCallback(
    (id: string, e: React.PointerEvent) => {
      const rootId = nodeToRoot[id];
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev: PointerEvent) => {
        setDrag({
          rootId,
          dx: (ev.clientX - startX) / scaleRef.current,
          dy: (ev.clientY - startY) / scaleRef.current,
        });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const dx = (ev.clientX - startX) / scaleRef.current;
        const dy = (ev.clientY - startY) / scaleRef.current;
        setDrag(null);
        if (dx || dy) {
          const root = tree.nodes[rootId];
          const cur = root.offset ?? { x: 0, y: 0 };
          updateNode(rootId, { offset: { x: cur.x + dx, y: cur.y + dy } });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [nodeToRoot, tree, updateNode]
  );

  const contentW = width;
  const contentH = height;

  const fitToView = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const scale = Math.min(vw / contentW, vh / contentH, 1) * 0.95;
    setView({
      x: (vw - contentW * scale) / 2,
      y: (vh - contentH * scale) / 2,
      scale: Math.max(0.15, scale),
    });
  }, [contentW, contentH]);

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
  const visibleIds = Object.keys(positions);

  const posOf = (id: string) => {
    const p = positions[id];
    if (drag && nodeToRoot[id] === drag.rootId) {
      return { x: p.x + drag.dx, y: p.y + drag.dy };
    }
    return p;
  };

  const edges: Array<{ from: string; to: string }> = [];
  visibleIds.forEach((id) => {
    const node = tree.nodes[id];
    if (!node || node.collapsed) {
      return;
    }
    node.children.forEach((c) => {
      if (positions[c]) {
        edges.push({ from: id, to: c });
      }
    });
  });

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
          width: contentW,
          height: contentH,
        }}
      >
        <Edges width={contentW} height={contentH}>
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
          {edges.map(({ from, to }) => {
            const a = posOf(from);
            const b = posOf(to);
            const sx = a.x + NODE_W;
            const sy = a.y + NODE_H / 2;
            const ex = b.x;
            const ey = b.y + NODE_H / 2;
            const midX = sx + (ex - sx) / 2;
            return (
              <path
                key={`${from}-${to}`}
                d={`M ${sx} ${sy} H ${midX} V ${ey} H ${ex}`}
                fill="none"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={2}
                markerEnd="url(#tree-arrow)"
              />
            );
          })}
        </Edges>

        {visibleIds.map((id) => {
          const node = tree.nodes[id];
          const p = posOf(id);
          const isSelected = selectedId === id;
          const isEditing = editingId === id;
          const hasChildren = node.children.length > 0;
          return (
            <NodeBox
              key={id}
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                background: nodeColor(node),
                outline: isSelected ? "2px solid #ffffff" : "none",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (moveMode && !readOnly) {
                  startTreeDrag(id, e);
                } else {
                  setSelectedId(id);
                }
              }}
              onDoubleClick={() => !readOnly && !moveMode && setEditingId(id)}
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
            </NodeBox>
          );
        })}
      </World>

      {!readOnly && (
        <Controls onPointerDown={(e) => e.stopPropagation()}>
          <Btn
            title={t("Move tool")}
            style={
              moveMode
                ? { background: "rgba(120,160,255,0.5)" }
                : undefined
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
 * Wrapper that forces a fresh document fetch before mounting the editor, so the
 * tree is always initialized from the latest saved data rather than a stale
 * cached model (the sidebar keeps documents cached, so opening one otherwise
 * skips the network fetch and its canvasData).
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

const NodeBox = styled.div`
  position: absolute;
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
