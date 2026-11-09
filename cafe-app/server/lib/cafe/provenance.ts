import { z } from "zod";

export const sourceTags = ["observed", "public", "estimate", "illustrative"] as const;
export const sourceTagSchema = z.enum(sourceTags);
export const sourceSchema = z.discriminatedUnion("tag", [
  z.object({ tag: z.enum(["observed", "estimate", "illustrative"]) }),
  z.object({
    tag: z.literal("public"),
    url: z.url({ protocol: /^https?$/ }).describe("Source URL"),
    retrievedAt: z.iso.date().describe("Date the published value was checked, YYYY-MM-DD"),
    supportingValue: z.string().trim().min(1).max(300).describe("Value the source actually reports, including units"),
  }),
]);

export type Source = z.infer<typeof sourceSchema>;
export type SourceTag = z.infer<typeof sourceTagSchema>;
export type TaggedNumber = { value: number; source: Source };

export function sourced(value: z.ZodNumber) {
  return z.object({ value, source: sourceSchema });
}

export function illustrative(value: number): TaggedNumber {
  return { value, source: { tag: "illustrative" } };
}

export function weakestTag(sources: Iterable<Pick<Source, "tag">>): SourceTag {
  let index = 0;
  for (const { tag } of sources) {
    const rank = sourceTags.indexOf(tag);
    if (rank < 0) throw new RangeError("Unknown provenance tag.");
    index = Math.max(index, rank);
  }
  return sourceTags[index]!;
}

export type TaggedValue<T> = Readonly<{ value: T; tag: SourceTag }>;
type SourceDependency = Pick<Source, "tag"> | Pick<TaggedNumber, "source">;

export function derive<T>(value: T, ...inputs: readonly SourceDependency[]): TaggedValue<T> {
  return { value, tag: weakestTag(inputs.map((input) => "source" in input ? input.source : input)) };
}

export function assertTaggedNumber(input: unknown, name = "Value"): asserts input is TaggedNumber {
  if (typeof input !== "object" || input === null || !("value" in input) || typeof input.value !== "number" || !Number.isFinite(input.value)) {
    throw new RangeError(`${name} must be a finite tagged number.`);
  }
  assertSource("source" in input ? input.source : undefined, name);
}

function assertSource(input: unknown, name: string): asserts input is Source {
  if (!sourceSchema.safeParse(input).success) {
    throw new RangeError(`${name} needs a valid source. A public source needs a URL, retrieval date and supporting value.`);
  }
}

declare const calculated: unique symbol;
export type CalculatedNumber = TaggedValue<number> & Readonly<{ [calculated]: true }>;
const calculatedNumbers = new WeakSet<object>();

function isCalculatedNumber(input: unknown): input is CalculatedNumber {
  return typeof input === "object" && input !== null && calculatedNumbers.has(input);
}

export function calculateMeasure(value: number, ...inputs: readonly (Source | TaggedNumber | CalculatedNumber)[]): CalculatedNumber {
  if (!Number.isFinite(value)) throw new RangeError("Calculated value must be finite.");
  const sources = inputs.map((input) => {
    if (isCalculatedNumber(input)) return input;
    if (typeof input === "object" && input !== null && "source" in input) {
      assertTaggedNumber(input, "Calculation input");
      return input.source;
    }
    assertSource(input, "Calculation input");
    return input;
  });
  const measure = Object.freeze(derive(value, ...sources)) as CalculatedNumber;
  calculatedNumbers.add(measure);
  return measure;
}

export function assertSourcedOrCalculated(input: TaggedNumber | CalculatedNumber, name: string): void {
  if (!isCalculatedNumber(input)) assertTaggedNumber(input, name);
}
