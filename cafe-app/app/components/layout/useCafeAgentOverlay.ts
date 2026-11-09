import { useT } from "@agent-native/core/client/i18n";
import { useLayoutEffect, type RefObject } from "react";

const OPEN_PANEL = '.agent-sidebar-panel[data-agent-sidebar-state="open"]';
const OVERLAY =
  '[data-agent-sidebar-layout="mobile"], [data-agent-sidebar-layout="overlay"]';
const BACKGROUND = "[data-cafe-overlay-background]";
const FOCUSABLE =
  "a[href], button, input, select, textarea, summary, iframe, [contenteditable], [tabindex]";

function isVisible(element: HTMLElement) {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === "visible" &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]')
  );
}

function tabStops(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(
      (element) =>
        (element.tabIndex >= 0 ||
          (element.isContentEditable && !element.hasAttribute("tabindex"))) &&
        !element.matches(":disabled") &&
        isVisible(element),
    )
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
}

export function useCafeAgentOverlay(
  shell: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const t = useT();
  const dialogLabel = t("agentPanel.askAgent");
  const toggleLabel = t("agentPanel.toggleAgent");

  useLayoutEffect(() => {
    const container = shell.current;
    if (!enabled || !container) return;
    const root = container;

    let overlay: {
      panel: HTMLElement;
      opener: HTMLElement | null;
      release: () => void;
    } | null = null;
    let lastOpener: HTMLElement | null = null;
    let returnFrame = 0;
    let pendingFocus: { opener: HTMLElement | null } | null = null;

    function rememberOpener(event: Event) {
      if (overlay || !(event.target instanceof Element)) return;
      const target =
        event.type === "click"
          ? event.target.closest<HTMLElement>(FOCUSABLE)
          : event.target;
      if (target instanceof HTMLElement && !target.closest(OPEN_PANEL))
        lastOpener = target;
    }

    function restoreFocus() {
      if (!pendingFocus || root.querySelector(OPEN_PANEL)) return;
      const { opener } = pendingFocus;
      const toggle = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
      ).find(
        (button) =>
          button.getAttribute("aria-label") === toggleLabel &&
          isVisible(button),
      );
      const target = opener && isVisible(opener) ? opener : toggle;
      if (target) {
        pendingFocus = null;
        target.focus({ preventScroll: true });
      }
    }

    function syncOverlay() {
      const panel = root.querySelector<HTMLElement>(OPEN_PANEL);
      if (panel && panel === overlay?.panel && panel.matches(OVERLAY)) {
        if (document.activeElement === document.body)
          panel.focus({ preventScroll: true });
        return;
      }
      const previous = overlay;
      previous?.release();
      overlay = null;

      if (!panel?.matches(OVERLAY)) {
        if (previous && !panel) {
          pendingFocus = { opener: previous.opener };
          returnFrame = requestAnimationFrame(restoreFocus);
        } else {
          restoreFocus();
        }
        return;
      }

      cancelAnimationFrame(returnFrame);
      pendingFocus = null;
      const focused = document.activeElement;
      const opener =
        previous?.opener ??
        lastOpener ??
        (focused instanceof HTMLElement &&
        root.contains(focused) &&
        !panel.contains(focused)
          ? focused
          : null);
      const attributes = {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": dialogLabel,
        tabindex: "-1",
      };
      const original = Object.keys(attributes).map(
        (name) => [name, panel.getAttribute(name)] as const,
      );
      for (const [name, value] of Object.entries(attributes))
        panel.setAttribute(name, value);

      const background = Array.from(
        root.querySelectorAll<HTMLElement>(BACKGROUND),
      ).map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
      if (!panel.contains(document.activeElement))
        panel.focus({ preventScroll: true });
      for (const { element } of background) {
        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      }

      overlay = {
        panel,
        opener,
        release() {
          for (const { element, inert, ariaHidden } of background) {
            element.inert = inert;
            if (ariaHidden === null) element.removeAttribute("aria-hidden");
            else element.setAttribute("aria-hidden", ariaHidden);
          }
          for (const [name, value] of original) {
            if (value === null) panel.removeAttribute(name);
            else panel.setAttribute(name, value);
          }
        },
      };
    }

    function handleKeys(event: KeyboardEvent) {
      if (!overlay || event.isComposing) return;
      const { panel } = overlay;
      const target = event.target;
      // Portalled chat menus and dialogs handle their own keyboard events.
      if (
        !(target instanceof Node) ||
        (!panel.contains(target) && target !== document.body)
      )
        return;

      if (event.key === "Escape") {
        const nestedControl =
          target instanceof Element &&
          target.closest(
            '[aria-expanded="true"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
          );
        if (event.defaultPrevented && nestedControl && nestedControl !== panel)
          return;
        event.preventDefault();
        window.dispatchEvent(new Event("agent-panel:close"));
        return;
      }
      if (
        event.defaultPrevented ||
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;

      const stops = tabStops(panel);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (
        !(target instanceof HTMLElement && stops.includes(target)) ||
        target === (event.shiftKey ? first : last)
      ) {
        event.preventDefault();
        ((event.shiftKey ? last : first) ?? panel).focus();
      }
    }

    // AgentSidebar exposes its actual layout and open state on the panel.
    const observer = new MutationObserver(syncOverlay);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-agent-sidebar-layout",
        "data-agent-sidebar-state",
      ],
    });
    root.addEventListener("focusin", rememberOpener);
    root.addEventListener("click", rememberOpener, true);
    window.addEventListener("keydown", handleKeys);
    syncOverlay();

    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", rememberOpener);
      root.removeEventListener("click", rememberOpener, true);
      window.removeEventListener("keydown", handleKeys);
      cancelAnimationFrame(returnFrame);
      overlay?.release();
    };
  }, [dialogLabel, enabled, shell, toggleLabel]);
}
