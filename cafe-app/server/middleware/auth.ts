import { runAuthGuard } from "@agent-native/core/server";
import { defineEventHandler, getMethod, getRequestURL } from "h3";

const titlePath = /^\/_agent-native\/agent-chat\/generate-title(?:\/|$)/;

function matchesTitleRoute(path: string) {
  try {
    return titlePath.test(decodeURIComponent(path));
  } catch {
    return false;
  }
}

export default defineEventHandler(async (event) => {
  const response = await runAuthGuard(event);
  if (response !== undefined) return response;
  // Core 0.226.0 generates titles outside the reply guard. An empty title uses the toolkit's existing user-message fallback.
  if (
    getMethod(event) === "POST" &&
    matchesTitleRoute(getRequestURL(event).pathname)
  )
    return { title: "" };
});
