import {
  appBasePath,
  appPathFromLocalRoute,
} from "@agent-native/core/client/api-path";
import { useAgentRouteState } from "@agent-native/core/client/navigation";
import { screenPaths, type ScreenView } from "@shared/screen-navigation";
import { useLocation } from "react-router";

import {
  cafeDocuments,
  useCafeDocument,
  type CafeDocument,
} from "@/hooks/use-cafe-document";
import {
  chatThreadPath,
  HOME_PATH,
  isChatPathname,
  NEW_CHAT_PATH,
  threadIdFromPath,
} from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

export interface NavigationState {
  view?: string;
  path?: string;
  publicPath?: string;
  threadId?: string;
  scenarioId?: string;
  comparisonScenarioId?: string;
  hash?: string;
  document?: CafeDocument;
  documentHash?: `#${CafeDocument}`;
}

export function useNavigationState() {
  const { document: cafeDocument } = useCafeDocument();
  const location = useLocation();
  useAgentRouteState<NavigationState>({
    browserTabId: TAB_ID,
    requestSource: TAB_ID,
    getNavigationState: ({ pathname, hash, searchParams }) => {
      const navigation = navigationStateForPath(pathname);
      if (navigation.view !== "cafe") return navigation;
      const scenarioId = searchParams.get("scenario");
      const comparisonScenarioId = searchParams.get("compare");
      return {
        ...navigation,
        hash,
        ...(cafeDocument
          ? {
              document: cafeDocument,
              documentHash: `#${cafeDocument}` as const,
            }
          : {}),
        ...(scenarioId ? { scenarioId } : {}),
        ...(comparisonScenarioId ? { comparisonScenarioId } : {}),
      };
    },
    getCommandPath: commandPathForNavigation,
    onNavigate: (_command, path) => {
      const { pathname, search, hash } = location;
      if (
        pathname !== "/cafe" ||
        path !== `${pathname}${search}${hash}` ||
        !cafeDocuments.some((name) => hash === `#${name}`)
      )
        return;

      // The framework skips an identical URL. Scroll only the café pane so its rail stays visible.
      const section = document.getElementById(hash.slice(1));
      const pane = section?.closest(".cafe-workspace")?.closest("main");
      if (!section || !pane) return;
      const padding =
        parseFloat(getComputedStyle(pane).scrollPaddingBlockStart) || 0;
      const margin =
        parseFloat(getComputedStyle(section).scrollMarginBlockStart) || 0;
      pane.scrollTop +=
        section.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        padding -
        margin;
      if (document.activeElement === document.body)
        section.focus({ preventScroll: true });
    },
  });
}

export function commandPathForNavigation(command: NavigationState): string {
  const fallbackPath = pathForCommand(command);
  const path = typeof command?.path === "string" ? command.path : "";
  if (!path) return fallbackPath;

  const basePath = appBasePath();
  if (!basePath) return path;

  const suffixIndex = path.search(/[?#]/);
  const pathname = suffixIndex === -1 ? path : path.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : path.slice(suffixIndex);
  const publicPath =
    typeof command?.publicPath === "string" ? command.publicPath : "";
  const publicPathSuffixIndex = publicPath.search(/[?#]/);
  const declaredPublicPath =
    publicPathSuffixIndex === -1
      ? publicPath
      : publicPath.slice(0, publicPathSuffixIndex);
  const publicViewPath = appPathFromLocalRoute(pathForView(command?.view));
  if (
    matchesPathPrefix(pathname, basePath) &&
    (matchesPathPrefix(pathname, publicViewPath) ||
      (declaredPublicPath && declaredPublicPath === pathname))
  ) {
    return `${pathname.slice(basePath.length) || "/"}${suffix}`;
  }
  return path;
}

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function navigationStateForPath(pathname: string): NavigationState {
  const threadId = threadIdFromPath(pathname);
  return {
    view: viewForPath(pathname),
    path: pathname,
    publicPath: appPathFromLocalRoute(pathname),
    ...(threadId ? { threadId } : {}),
  };
}

function viewForPath(pathname: string): ScreenView {
  if (isChatPathname(pathname)) return "chat";
  if (pathname === HOME_PATH) return "home";
  if (pathname === "/cafe") return "cafe";
  if (pathname.startsWith("/database")) return "database";
  if (pathname.startsWith("/extensions")) return "extensions";
  if (pathname.startsWith("/observability")) return "observability";
  if (pathname.startsWith("/settings/agent") || pathname.startsWith("/agent")) {
    return "agent";
  }
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/team")) return "settings";
  return "chat";
}

function pathForView(view?: string): string {
  if (view === "ask") return NEW_CHAT_PATH;
  if (view === "team") return "/settings/organization";
  return view && Object.prototype.hasOwnProperty.call(screenPaths, view)
    ? screenPaths[view as ScreenView]
    : HOME_PATH;
}

export function pathForCommand(command: any): string {
  const path = pathForView(command?.view);
  if (command?.view !== "chat" && command?.view !== "ask") return path;
  const threadId =
    typeof command?.threadId === "string" ? command.threadId.trim() : "";
  return threadId ? chatThreadPath(threadId) : path;
}
