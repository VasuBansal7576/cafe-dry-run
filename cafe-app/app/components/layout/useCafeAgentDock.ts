import {
  AGENT_SIDEBAR_MIN_WIDTH,
  getAgentSidebarMaxWidth,
} from "@agent-native/core/client/agent-chat";
import {
  AGENT_SIDEBAR_WIDTH_STEP,
  snapAgentSidebarWidth,
} from "@agent-native/core/client/agent-sidebar-state";
import { useT } from "@agent-native/core/client/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, PointerEvent } from "react";

const MIN_CANVAS_WIDTH = 390;
const DEFAULT_DOCK_WIDTH = 384;
const WIDTH_KEY = "cafe.agent-dock-width";
const FRAMEWORK_WIDTH_KEY = "agent-native-sidebar-width";

function readPreferredWidth() {
  try {
    const saved =
      localStorage.getItem(WIDTH_KEY) ??
      localStorage.getItem(FRAMEWORK_WIDTH_KEY);
    const width = saved === null ? DEFAULT_DOCK_WIDTH : Number(saved);
    if (Number.isFinite(width)) return width;
  } catch {
    // Storage is optional. The default works in a private session.
  }
  return DEFAULT_DOCK_WIDTH;
}

export function useCafeAgentDock(enabled: boolean) {
  const t = useT();
  const shell = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const [maxWidth, setMaxWidth] = useState(DEFAULT_DOCK_WIDTH);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_DOCK_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      drag.current = null;
      setDragWidth(null);
      return;
    }
    if (!shell.current) return;
    const root = shell.current;
    const left = navigation.current;
    setPreferredWidth(readPreferredWidth());
    const measure = () => {
      const viewport = root.clientWidth;
      const available = viewport - (left?.offsetWidth ?? 0) - 1;
      const limit = Math.min(
        getAgentSidebarMaxWidth(viewport),
        available - MIN_CANVAS_WIDTH,
      );
      const step = AGENT_SIDEBAR_WIDTH_STEP;
      setMaxWidth(
        Math.max(AGENT_SIDEBAR_MIN_WIDTH, Math.floor(limit / step) * step),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (left) observer.observe(left);
    return () => observer.disconnect();
  }, [enabled]);

  const clamp = (value: number) =>
    Math.min(
      maxWidth,
      Math.max(AGENT_SIDEBAR_MIN_WIDTH, snapAgentSidebarWidth(value)),
    );
  const width = clamp(dragWidth ?? preferredWidth);
  const style:
    | (CSSProperties & {
        "--cafe-agent-dock-width": string;
        "--cafe-canvas-min-width": string;
      })
    | undefined = enabled
    ? {
        "--cafe-agent-dock-width": `${width}px`,
        "--cafe-canvas-min-width": `${MIN_CANVAS_WIDTH}px`,
      }
    : undefined;

  function saveWidth(next: number) {
    setPreferredWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // The in-memory preference still applies.
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragWidth(null);
    if (current.width !== current.startWidth) saveWidth(clamp(current.width));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const separatorProps: HTMLAttributes<HTMLDivElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-label": t("agentChat.agentPanel.resizePanel"),
    "aria-orientation": "vertical",
    "aria-valuemin": AGENT_SIDEBAR_MIN_WIDTH,
    "aria-valuemax": maxWidth,
    "aria-valuenow": width,
    onKeyDown(event) {
      let target: number;
      switch (event.key) {
        case "Home":
          target = AGENT_SIDEBAR_MIN_WIDTH;
          break;
        case "End":
          target = maxWidth;
          break;
        case "ArrowLeft":
          target = width + AGENT_SIDEBAR_WIDTH_STEP;
          break;
        case "ArrowRight":
          target = width - AGENT_SIDEBAR_WIDTH_STEP;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = clamp(target);
      if (next !== width) saveWidth(next);
    },
    onPointerDown(event) {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width, width };
      setDragWidth(width);
    },
    onPointerMove(event) {
      const current = drag.current;
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId))
        return;
      current.width = clamp(
        current.startWidth + current.startX - event.clientX,
      );
      setDragWidth(current.width);
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  };

  return {
    shell,
    navigation,
    style,
    separatorProps,
  };
}
