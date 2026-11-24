"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Background, Controls, ReactFlow, useReactFlow, type Edge, type Node, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { panelClass } from "./workspace-styles";

export const productNodeStyle = { width: 200, background: "#254889", color: "white", fontWeight: 700 };
export const graphNodeStyle = { width: 200, background: "#edf2ff", pointerEvents: "auto" as const };
export const graphNodeButtonClass = "nodrag w-full font-semibold text-[#31569e] focus-visible:outline-2 focus-visible:outline-[#31569e]";

function FitGraph({ nodes, layoutKey, canvas }: { nodes: Node[]; layoutKey: string; canvas: RefObject<HTMLDivElement | null> }) {
  const { fitBounds, viewportInitialized } = useReactFlow();
  const x = Math.min(...nodes.map((node) => node.position.x));
  const y = Math.min(...nodes.map((node) => node.position.y));
  const width = Math.max(...nodes.map((node) => node.position.x)) - x + graphNodeStyle.width;
  const height = Math.max(...nodes.map((node) => node.position.y)) - y + 95;
  useEffect(() => {
    if (!viewportInitialized || !canvas.current) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { void fitBounds({ x, y, width, height }, { padding: 0.16 }); });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas.current);
    fit();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [layoutKey, viewportInitialized, x, y, width, height, fitBounds, canvas]);
  return null;
}

export function GraphCanvas({ nodes, edges, label, layoutKey, nodeTypes }: { nodes: Node[]; edges: Edge[]; label: string; layoutKey?: string; nodeTypes?: NodeTypes }) {
  const canvas = useRef<HTMLDivElement>(null);
  return <div ref={canvas} className={panelClass} style={{ height: 490, minWidth: 0, overflow: "hidden" }} aria-label={label} role="region">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={layoutKey === undefined ? undefined : { maxZoom: 1 }}
      minZoom={0.15} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
      <Background color="#d9e2f1" gap={20} />
      <Controls showInteractive={false} />
      {layoutKey !== undefined && <FitGraph nodes={nodes} layoutKey={layoutKey} canvas={canvas} />}
    </ReactFlow>
  </div>;
}
