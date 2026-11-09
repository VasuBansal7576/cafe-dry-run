import snapshot from "./indiranagar.json";

export type Coordinate = { lat: number; lon: number };
export type Spot = Coordinate & { label: string };
export const placeGroupKeys = [
  "food",
  "office",
  "education",
  "transit",
] as const;
export type PlaceGroup = (typeof placeGroupKeys)[number];
export const mapCoverage = ["covered", "partial", "outside"] as const;

type OsmPlace = Coordinate & {
  osmType: "node" | "way";
  osmId: number;
  name: string;
  group: PlaceGroup;
  category: string;
};

export type NearbyPlace = OsmPlace & { distanceMetres: number };
export type MapWay = {
  osmId: number;
  kind: "green" | "building" | "path" | "street" | "main" | "rail";
  name: string | null;
  points: [number, number][];
};

const { features: snapshotWays, places: snapshotPlaces, ...siteMap } = snapshot;
export { siteMap };
export const features = snapshotWays as MapWay[];
const places = snapshotPlaces as OsmPlace[];

const { label, lat, lon } = siteMap.anchors[0]!;
export const defaultSpot: Spot = { label, lat, lon };

export const searchRadiusMetres = 600;
export const placeGroups: Record<PlaceGroup, string> = {
  food: "Cafés",
  office: "Offices",
  education: "Colleges and universities",
  transit: "Transit",
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function isCovered({ lat, lon }: Coordinate): boolean {
  const { south, north, west, east } = siteMap.bounds;
  return lat >= south && lat <= north && lon >= west && lon <= east;
}

export function spotAt(coordinate: Coordinate): Spot {
  const anchor = siteMap.anchors.find(
    ({ lat, lon }) => lat === coordinate.lat && lon === coordinate.lon,
  );
  return {
    ...coordinate,
    label:
      anchor?.label ??
      (isCovered(coordinate) ? "Indiranagar site pin" : "Pinned coordinates"),
  };
}

export function sameSpot(a: Spot, b: Spot): boolean {
  return a.lat === b.lat && a.lon === b.lon && a.label === b.label;
}

function normalizeName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

export function isSnapshotPlaceName(name: string): boolean {
  return (
    siteMap.anchors.some(({ label }) => label === name) ||
    places.some((place) => place.name === name)
  );
}

export function findNamedSpot(name: string): Spot | undefined {
  const query = normalizeName(name);
  if (query === "indiranagar" || query === normalizeName(siteMap.name)) {
    return defaultSpot;
  }
  const anchor = siteMap.anchors.find(({ label }) => {
    const normalized = normalizeName(label);
    return normalized === query || normalized.replace(/^near /, "") === query;
  });
  if (anchor) return { label: anchor.label, lat: anchor.lat, lon: anchor.lon };

  const [place, duplicate] = places.filter(
    (candidate) => normalizeName(candidate.name) === query,
  );
  if (place && !duplicate) {
    return { label: place.name, lat: place.lat, lon: place.lon };
  }
  return undefined;
}

export function spotSourceTag(spot: Spot) {
  const snapshotSpot = findNamedSpot(spot.label);
  return snapshotSpot && sameSpot(spot, snapshotSpot)
    ? ("public" as const)
    : ("estimate" as const);
}

function distanceBetween(from: Coordinate, to: Coordinate): number {
  const latitudeDifference = radians(to.lat - from.lat);
  const longitudeDifference = radians(to.lon - from.lon);
  const halfChord =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(halfChord));
}

export function isPartialCoverage(spot: Coordinate): boolean {
  if (!isCovered(spot)) return false;
  const { south, north, west, east } = siteMap.bounds;
  return [
    { lat: south, lon: spot.lon },
    { lat: north, lon: spot.lon },
    { lat: spot.lat, lon: west },
    { lat: spot.lat, lon: east },
  ].some((edge) => distanceBetween(spot, edge) < searchRadiusMetres);
}

export function nearbyPlaces(spot: Coordinate): NearbyPlace[] {
  if (!isCovered(spot)) return [];
  const sorted = places
    .map((place) => ({
      ...place,
      distanceMetres: distanceBetween(spot, place),
    }))
    .filter(({ distanceMetres }) => distanceMetres <= searchRadiusMetres)
    .sort((a, b) => a.distanceMetres - b.distanceMetres);

  return placeGroupKeys.flatMap((group) => {
    const nearest = sorted.find((place) => place.group === group);
    return nearest
      ? [{ ...nearest, distanceMetres: Math.round(nearest.distanceMetres) }]
      : [];
  });
}

export function describeSpot(spot: Coordinate) {
  const places = nearbyPlaces(spot);
  const coverage = !isCovered(spot)
    ? "outside"
    : isPartialCoverage(spot)
      ? "partial"
      : "covered";
  return {
    coverage,
    places,
    missingGroups: placeGroupKeys.filter(
      (group) => !places.some((place) => place.group === group),
    ),
  } as const;
}
