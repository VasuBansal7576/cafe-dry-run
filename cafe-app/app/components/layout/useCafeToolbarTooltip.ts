import { useLayoutEffect, type RefObject } from "react";

const TOOLBAR = '[data-agent-composer-slot="toolbar"]';
const POPPER = "[data-radix-popper-content-wrapper]";

export function useCafeToolbarTooltip(
  shell: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const root = shell.current;
    if (!enabled || !root) return;

    let active: {
      portal: HTMLElement;
      trigger: HTMLElement;
      toolbar: HTMLElement;
    } | null = null;
    let frame = 0;

    const resize = new ResizeObserver(placeTooltip);
    function placeTooltip() {
      if (!active) return;
      const { portal, trigger, toolbar } = active;
      const button = trigger.getBoundingClientRect();
      const row = toolbar.getBoundingClientRect();
      portal.style.setProperty(
        "--cafe-tooltip-above",
        `${row.top - button.top - 4}px`,
      );
      portal.style.setProperty(
        "--cafe-tooltip-below",
        `${row.bottom - button.bottom + 4}px`,
      );
    }

    function release() {
      resize.disconnect();
      active?.portal.removeAttribute("data-cafe-toolbar-tooltip");
      active?.portal.style.removeProperty("--cafe-tooltip-above");
      active?.portal.style.removeProperty("--cafe-tooltip-below");
      active = null;
    }

    // Radix portals the tooltip. Its trigger identifies the actual content.
    function sync() {
      const trigger = root?.querySelector<HTMLElement>(
        `.agent-sidebar-panel[data-agent-sidebar-state="open"] ${TOOLBAR} button[data-state$="-open"][aria-describedby]`,
      );
      const id = trigger?.getAttribute("aria-describedby");
      const portal = id
        ? document.getElementById(id)?.closest<HTMLElement>(POPPER)
        : null;
      const toolbar = trigger?.closest<HTMLElement>(TOOLBAR);
      if (active?.portal === portal && active?.trigger === trigger) return;
      release();
      if (!portal || !trigger || !toolbar) return;

      active = { portal, trigger, toolbar };
      portal.setAttribute("data-cafe-toolbar-tooltip", "");
      resize.observe(trigger);
      resize.observe(toolbar);
      placeTooltip();
    }

    const portals = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    portals.observe(document.body, { childList: true });
    sync();

    return () => {
      portals.disconnect();
      cancelAnimationFrame(frame);
      release();
    };
  }, [enabled, shell]);
}
