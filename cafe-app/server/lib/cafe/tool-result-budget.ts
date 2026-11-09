import type { ActionRunContext } from "@agent-native/core/action";

export const sampleResultId = "00000000-0000-4000-8000-000000000000";

export function fitsToolResult(value: object, budget: number): boolean {
  return JSON.stringify(value, null, 2).length <= budget;
}

export function withoutToolResultBudget(context: ActionRunContext | undefined) {
  if (!context) return;
  const { maxResultChars: _, ...unbudgeted } = context;
  return unbudgeted;
}
