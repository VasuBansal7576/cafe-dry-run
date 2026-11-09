export function fitsToolResult(value: object, budget: number): boolean {
  return JSON.stringify(value, null, 2).length <= budget;
}
