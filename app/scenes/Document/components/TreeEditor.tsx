import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { JSONObject } from "@shared/types";
import type Document from "~/models/Document";
import useStores from "~/hooks/useStores";

/**
 * Project tree editor (MVP).
 *
 * An infinite, dark canvas that renders a self-aligning tree of rectangular
 * nodes connected by elbow arrows. Each node has text, an optional emoji
 * (inherited by children), and a status that colors the rectangle. Nodes can be
 * added, collapsed, and deleted; the whole tree supports undo/redo and is
 * autosaved to the document's `canvasData` field.
 *
 * Phase 2 (not yet implemented): drag-to-reorder with a greyed preview and
 * insertion onto connector arrows.
 */

type TreeStatus = "not_started" | "in_progress" | "to_validate" | "done";

type TreeNode = {
  id: string;
  text: string;
  emoji?: string;
  status: TreeStatus;
  collapsed?: boolean;
  children: string[];
};

type TreeData = {
  rootId: string;
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
const PADDING = 60;
const DEFAULT_BG = "#1b211f";

const STATUSES: Record<
  TreeStatus,
  { labelKey: string; color: string; text: string }
> = {
  not_started: { labelKey: "Not started", color: "#6b7280", text: "#ffffff" },
  in_progress: { labelKey: "In progress", color: "#a85a38", text: "#ffffff" },
  to_validate: { labelKey: "To validate", color: "#8f9147", text: "#ffffff" },
  done: { labelKey: "Done", color: "#2f7d4f", text: "#ffffff" },
};
const STATUS_ORDER: TreeStatus[] = [
  "not_started",
  "in_progress",
  "to_validate",
  "done",
];

function uid() {
  // Runtime-only id; collisions are astronomically unlikely for a single tree.
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

function defaultTree(): TreeData {
  const id = uid();
  return {
    rootId: id,
    nodes: {
      [id]: {
        id,
        text: "",
        emoji: "",
        status: "not_started",
        children: [],
        collapsed: false,
      },
    },
  };
}

function normalize(data: unknown): TreeData | null {
  const d = data as TreeData | null;
  if (d && d.rootId && d.nodes && d.nodes[d.rootId]) {
    return d;
  }
  return null;
}

type Positions = Record<string, { x: number; y: number }>;

/** Computes a tidy left-to-right layout where each node's children share a column. */
function computeLayout(tree: TreeData): {
  positions: Positions;
  width: number;
  height: number;
} {
  const positions: Positions = {};
  let leaf = 0;
  let maxDepth = 0;

  const walk = (id: string, depth: number): number => {
    const node = tree.nodes[id];
    if (!node) {
      return 0;
    }
    maxDepth = Math.max(maxDepth, depth);
    const x = depth * (NODE_W + H_GAP);
    const kids = node.collapsed ? [] : node.children.filter((c) => tree.nodes[c]);

    if (kids.length === 0) {
      const y = leaf * (NODE_H + V_GAP);
      leaf++;
      positions[id] = { x, y };
      return y;
    }

    const ys = kids.map((cid) => walk(cid, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    positions[id] = { x, y };
    return y;
  };

  walk(tree.rootId, 0);

  const width = (maxDepth + 1) * (NODE_W + H_GAP);
  const height = Math.max(1, leaf) * (NODE_H + V_GAP);
  return { positions, width, height };
}

function TreeEditor({ document, readOnly }: Props) {
  const { t } = useTranslation();
  const { documents } = useStores();

  const [tree, setTree] = React.useState<TreeData>(
    () => normalize(document.canvasData) ?? defaultTree()
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );

  // Adopt server data if it arrives after mount and the user hasn't edited yet.
  const dirtyRef = React.useRef(false);
  const loadedRef = React.useRef(!!normalize(document.canvasData));
  React.useEffect(() => {
    if (loadedRef.current || dirtyRef.current) {
      return;
    }
    const incoming = normalize(document.canvasData);
    if (incoming) {
      loadedRef.current = true;
      setTree(incoming);
    }
  }, [document.canvasData]);

  // Undo / redo history.
  const history = React.useRef<TreeData[]>([tree]);
  const historyIndex = React.useRef(0);

  const persist = React.useRef<ReturnType<typeof setTimeout>>();
  const scheduleSave = React.useCallback(
    (next: TreeData) => {
      if (persist.current) {
        clearTimeout(persist.current);
      }
      persist.current = setTimeout(() => {
        void documents.update({
          id: document.id,
          canvasData: next as unknown as JSONObject,
        });
      }, 800);
    },
    [documents, document.id]
  );

  const commit = React.useCallback(
    (next: TreeData) => {
      dirtyRef.current = true;
      // Truncate any redo branch, push the new state.
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
      const id = uid();
      const child: TreeNode = {
        id,
        text: "",
        emoji: parent.emoji, // children inherit the parent's icon by default
        status: "not_started",
        children: [],
        collapsed: false,
      };
      commit({
        ...tree,
        nodes: {
          ...tree.nodes,
          [id]: child,
          [parentId]: {
            ...parent,
            collapsed: false,
            children: [...parent.children, id],
          },
        },
      });
      setSelectedId(id);
      setEditingId(id);
    },
    [tree, commit]
  );

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
      if (id === tree.rootId) {
        return;
      }
      const ids = collectSubtree(id, []);
      const nodes = { ...tree.nodes };
      ids.forEach((nid) => delete nodes[nid]);
      // detach from parent
      Object.keys(nodes).forEach((nid) => {
        if (nodes[nid].children.includes(id)) {
          nodes[nid] = {
            ...nodes[nid],
            children: nodes[nid].children.filter((c) => c !== id),
          };
        }
      });
      commit({ ...tree, nodes });
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

  // ---- pan / zoom ----------------------------------------------------------

  const [view, setView] = React.useState({ x: 40, y: 40, scale: 1 });

  // Panning: start on a background press and track via window listeners so the
  // drag keeps working even when the pointer leaves the viewport. Nodes stop
  // propagation on their own press, so this only fires on empty canvas.
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
      // plain wheel pans vertically, shift+wheel horizontally
      setView((v) => ({
        ...v,
        x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: v.y - (e.shiftKey ? 0 : e.deltaY),
      }));
      return;
    }
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => {
      const scale = Math.min(2.5, Math.max(0.2, v.scale * factor));
      return { ...v, scale };
    });
  };

  // ---- keyboard: undo / redo ----------------------------------------------

  const containerRef = React.useRef<HTMLDivElement>(null);
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

  const { positions, width, height } = React.useMemo(
    () => computeLayout(tree),
    [tree]
  );
  const bg = tree.bgColor || DEFAULT_BG;
  const contentW = width + PADDING * 2;
  const contentH = height + PADDING * 2;

  const visibleIds = Object.keys(positions);
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
          {edges.map(({ from, to }) => {
            const a = positions[from];
            const b = positions[to];
            const sx = PADDING + a.x + NODE_W;
            const sy = PADDING + a.y + NODE_H / 2;
            const ex = PADDING + b.x;
            const ey = PADDING + b.y + NODE_H / 2;
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
        </Edges>

        {visibleIds.map((id) => {
          const node = tree.nodes[id];
          const p = positions[id];
          const status = STATUSES[node.status];
          const isSelected = selectedId === id;
          const isEditing = editingId === id;
          const hasChildren = node.children.length > 0;
          return (
            <NodeBox
              key={id}
              style={{
                left: PADDING + p.x,
                top: PADDING + p.y,
                width: NODE_W,
                height: NODE_H,
                background: status.color,
                color: status.text,
                outline: isSelected ? "2px solid #ffffff" : "none",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelectedId(id);
              }}
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

              {isSelected && !readOnly && (
                <Toolbar onPointerDown={(e) => e.stopPropagation()}>
                  <EmojiEdit
                    title={t("Change icon")}
                    value={node.emoji ?? ""}
                    placeholder="🙂"
                    maxLength={4}
                    onChange={(e) => updateNode(id, { emoji: e.target.value })}
                  />
                  <StatusRow>
                    {STATUS_ORDER.map((s) => (
                      <Swatch
                        key={s}
                        title={t(STATUSES[s].labelKey)}
                        style={{
                          background: STATUSES[s].color,
                          outline:
                            node.status === s
                              ? "2px solid #fff"
                              : "1px solid rgba(255,255,255,0.3)",
                        }}
                        onClick={() => updateNode(id, { status: s })}
                      />
                    ))}
                  </StatusRow>
                  <Btn title={t("Add child")} onClick={() => addChild(id)}>
                    +
                  </Btn>
                  <Btn title={t("Add child")} onClick={() => addChild(id)}>
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
                  {id !== tree.rootId && (
                    <Btn
                      title={t("Delete")}
                      $danger
                      onClick={() => requestDelete(id)}
                    >
                      🗑
                    </Btn>
                  )}
                </Toolbar>
              )}
            </NodeBox>
          );
        })}
      </World>

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

const Viewport = styled.div`
  position: relative;
  width: 100%;
  height: calc(100vh - 140px);
  min-height: 480px;
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

const NodeBox = styled.div`
  position: absolute;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
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

const EmojiEdit = styled.input`
  width: 28px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  border-radius: 4px;
  padding: 2px;
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
