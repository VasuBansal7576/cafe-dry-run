import { useLayoutEffect, type RefObject } from "react";

const OPEN_TAB_STRIP =
  '.agent-sidebar-panel[data-agent-sidebar-state="open"][data-agent-sidebar-layout="desktop"] .agent-sidebar-chat-header .agent-tabs-scroll';

export function useCafeAgentTabs(
  shell: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const root = shell.current;
    if (!enabled || !root) return;

    let strip: HTMLElement | null = null;
    let activeGroup: HTMLElement | null = null;
    let frame = 0;

    function scheduleReveal() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!strip || !activeGroup) return;

        const viewport = strip.getBoundingClientRect();
        const group = activeGroup.getBoundingClientRect();
        const gutter = Math.max(
          0,
          Math.min(
            parseFloat(getComputedStyle(strip).paddingInlineStart),
            (strip.clientWidth - group.width) / 2,
          ),
        );
        const left = viewport.left + strip.clientLeft + gutter;
        const right = left + strip.clientWidth - 2 * gutter;

        // Agent-Native reveals the selected tab button. Its close button is a sibling.
        if (group.left < left) strip.scrollLeft += group.left - left;
        else if (group.right > right) strip.scrollLeft += group.right - right;
      });
    }

    const resize = new ResizeObserver(scheduleReveal);
    function syncTabStrip(records: MutationRecord[] = []) {
      const nextStrip = root?.querySelector<HTMLElement>(OPEN_TAB_STRIP) ?? null;
      const nextGroup =
        nextStrip?.querySelector<HTMLElement>(
          ":scope > [data-agent-tab-item][data-active]",
        ) ?? null;
      if (strip === nextStrip && activeGroup === nextGroup) {
        if (
          activeGroup &&
          records.some(({ target }) => strip?.contains(target))
        )
          scheduleReveal();
        return;
      }

      resize.disconnect();
      strip = nextStrip;
      activeGroup = nextGroup;
      if (strip && activeGroup) {
        resize.observe(strip);
        resize.observe(activeGroup);
        scheduleReveal();
      }
    }

    const mutations = new MutationObserver(syncTabStrip);
    mutations.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-active",
        "data-agent-sidebar-state",
        "data-agent-sidebar-layout",
      ],
    });
    syncTabStrip();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [enabled, shell]);
}
