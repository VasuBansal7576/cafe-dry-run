import {
  useIsMutating,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

export function checkingRead(
  query: Pick<UseQueryResult, "isPending" | "fetchStatus">,
) {
  return query.isPending || query.fetchStatus !== "idle";
}

export function pairCalculationScope(aId?: string, bId?: string) {
  return ["cafe-calculation", "pair", aId, bId] as const;
}

export function useCalculationState(mutationKey: readonly unknown[]) {
  const client = useQueryClient();
  const filters = { mutationKey };
  return {
    pending: useIsMutating(filters) > 0,
    inFlight: () => client.isMutating(filters) > 0,
  };
}
