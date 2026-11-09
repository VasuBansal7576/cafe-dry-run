import { useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

import {
  defaultSpot,
  describeSpot,
  features,
  placeGroups,
  sameSpot,
  searchRadiusMetres,
  siteMap,
  spotAt,
  spotSourceTag,
  type Coordinate,
  type MapWay,
  type Spot,
} from "../../../shared/cafe/site-map";
import { Stamp } from "./provenance-stamp";

import "./site-map.css";

type SiteMapProps = {
  spot: Spot;
  spotRevision: number;
  onSetSpot: (coordinate: Coordinate) => void;
  pending?: boolean;
  error?: string | null | undefined;
};

const { south, west, north, east } = siteMap.bounds;
const metresPerDegree = 111_195;
const metresPerLongitude =
  metresPerDegree * Math.cos(((north + south) * Math.PI) / 360);
const width = Math.round((east - west) * metresPerLongitude);
const height = Math.round((north - south) * metresPerDegree);
const layers: MapWay["kind"][] = [
  "green",
  "building",
  "path",
  "street",
  "main",
  "rail",
];

function project(lon: number, lat: number): [number, number] {
  return [
    ((lon - west) / (east - west)) * width,
    ((north - lat) / (north - south)) * height,
  ];
}

function pointStyle({ lon, lat }: Coordinate): CSSProperties {
  const [x, y] = project(lon, lat);
  return { left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` };
}

const paths = layers.map((kind) => ({
  kind,
  path: features
    .filter((feature) => feature.kind === kind)
    .map(({ points }) => {
      const vertices = points.map(([lon, lat]) =>
        project(lon, lat)
          .map((value) => value.toFixed(1))
          .join(" "),
      );
      return `M${vertices.join("L")}${kind === "green" || kind === "building" ? "Z" : ""}`;
    })
    .join(""),
}));

const streetMarkers = [
  { letter: "A", osmId: 1378838837, segment: 4, fraction: 0.25, side: "left" },
  { letter: "B", osmId: 543470383, segment: 4, fraction: 0.04, side: "right" },
  { letter: "C", osmId: 107218840, segment: 5, fraction: 0.33, side: "above" },
  { letter: "D", osmId: 691155646, segment: 0, fraction: 0.57, side: "above" },
].flatMap(({ letter, osmId, segment, fraction, side }) => {
  const way = features.find((feature) => feature.osmId === osmId);
  const start = way?.points[segment];
  const end = way?.points[segment + 1];
  if (!way?.name || !start || !end) return [];
  const [lon, lat] = start;
  const [endLon, endLat] = end;
  return [
    {
      letter,
      osmId,
      side,
      name: way.name,
      coordinate: {
        lon: lon + (endLon - lon) * fraction,
        lat: lat + (endLat - lat) * fraction,
      },
    },
  ];
});

const arrowSteps = {
  ArrowUp: { lat: 1, lon: 0 },
  ArrowDown: { lat: -1, lon: 0 },
  ArrowLeft: { lat: 0, lon: -1 },
  ArrowRight: { lat: 0, lon: 1 },
};

function boundCoordinate(lat: number, lon: number): Coordinate {
  return {
    lat: Number(Math.min(north, Math.max(south, lat)).toFixed(7)),
    lon: Number(Math.min(east, Math.max(west, lon)).toFixed(7)),
  };
}

export function SiteMap({
  spot,
  spotRevision,
  onSetSpot,
  pending = false,
  error,
}: SiteMapProps) {
  const instructionId = useId();
  const titleId = useId();
  const mapId = useId();
  const streetKeyId = useId();
  const photoId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [showStorefront, setShowStorefront] = useState(false);
  const [draft, setDraft] = useState<{
    baseline: number;
    spot: Spot;
  } | null>(null);
  const [dragRevision, setDragRevision] = useState<number | null>(null);
  const dragging = dragRevision === spotRevision;
  const dragStart = useRef<{ spot: Spot; x: number; y: number } | null>(null);
  if (draft && draft.baseline !== spotRevision) setDraft(null);
  const current = draft?.baseline === spotRevision ? draft.spot : spot;
  const dirty = !sameSpot(current, spot);
  const selectedAnchor = siteMap.anchors.find((anchor) =>
    sameSpot(anchor, current),
  );
  const { coverage, places, missingGroups } = describeSpot(current);
  const pinTag = spotSourceTag(current);
  const covered = coverage !== "outside";
  const missing = missingGroups.map((group) =>
    placeGroups[group].toLowerCase(),
  );

  function choose(next: Spot) {
    if (!pending) setDraft({ baseline: spotRevision, spot: next });
  }

  function choosePoint(x: number, y: number) {
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds) return;
    const lon = west + ((x - bounds.left) / bounds.width) * (east - west);
    const lat = north - ((y - bounds.top) / bounds.height) * (north - south);
    choose(spotAt(boundCoordinate(lat, lon)));
  }

  function moveWithKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (!(event.key in arrowSteps)) return;
    event.preventDefault();
    if (pending) return;
    const step = event.shiftKey ? 100 : 20;
    const direction = arrowSteps[event.key as keyof typeof arrowSteps];
    const origin = covered ? current : defaultSpot;
    choose(
      spotAt(
        boundCoordinate(
          origin.lat + (direction.lat * step) / metresPerDegree,
          origin.lon + (direction.lon * step) / metresPerLongitude,
        ),
      ),
    );
  }

  function movePin(event: PointerEvent<HTMLSpanElement>) {
    const start = dragStart.current;
    if (!dragging || !start) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds) return;
    const [x, y] = project(start.spot.lon, start.spot.lat);
    choosePoint(
      bounds.left + (x / width) * bounds.width + event.clientX - start.x,
      bounds.top + (y / height) * bounds.height + event.clientY - start.y,
    );
  }

  function finishDrag(event: PointerEvent<HTMLSpanElement>) {
    if (dragging && dragStart.current) {
      if (event.type === "pointercancel") choose(dragStart.current.spot);
      else if (
        event.clientX !== dragStart.current.x ||
        event.clientY !== dragStart.current.y
      ) {
        movePin(event);
      }
    }
    dragStart.current = null;
    setDragRevision(null);
  }

  function save() {
    if (dirty && !pending) onSetSpot({ lat: current.lat, lon: current.lon });
  }

  return (
    <section className="cafe-site-map" aria-labelledby={titleId}>
      <div className="cafe-site-map-head">
        <div>
          <p className="cafe-map-stamp">
            {showStorefront
              ? "Site plate · Planning example"
              : "Site plate · Public data"}
          </p>
          <h3 id={titleId}>
            {showStorefront ? "Fictional storefront" : siteMap.name}
          </h3>
        </div>
        <label className="cafe-map-preset" hidden={showStorefront}>
          Preloaded spots
          <select
            value={selectedAnchor?.id ?? ""}
            disabled={pending}
            onChange={(event) => {
              const anchor = siteMap.anchors.find(
                ({ id }) => id === event.target.value,
              );
              if (anchor)
                choose({
                  label: anchor.label,
                  lat: anchor.lat,
                  lon: anchor.lon,
                });
            }}
          >
            <option value="" disabled>
              Custom pin
            </option>
            {siteMap.anchors.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        className="cafe-secondary cafe-site-view-toggle"
        type="button"
        aria-controls={`${mapId} ${photoId}`}
        onClick={() => setShowStorefront((show) => !show)}
      >
        {showStorefront ? "Show site map" : "Show storefront photo"}
      </button>

      <figure id={photoId} className="cafe-site-photo" hidden={!showStorefront}>
        <img
          src="/cafe/storefront-original.png"
          width={1672}
          height={941}
          loading="lazy"
          alt="Vacant fictional storefront with a rust-orange awning"
        />
        <figcaption>Illustrative photograph</figcaption>
      </figure>

      <figure id={mapId} className="cafe-map-plate" hidden={showStorefront}>
        <div
          className="cafe-map-art"
          ref={stage}
          style={{ aspectRatio: width / height }}
        >
          <button
            aria-label="Place site pin"
            aria-describedby={instructionId}
            aria-disabled={pending}
            className="cafe-map-surface"
            type="button"
            onKeyDown={moveWithKeys}
            onClick={(event) =>
              event.detail === 0
                ? save()
                : choosePoint(event.clientX, event.clientY)
            }
          >
            <svg
              viewBox={`0 0 ${width} ${height}`}
              aria-hidden="true"
              focusable="false"
            >
              {paths.map(({ kind, path }) => (
                <path
                  key={kind}
                  className={`cafe-map-${kind}`}
                  d={path}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </button>
          <div className="cafe-map-compass" aria-hidden="true">
            ↑ N
          </div>
          <div
            className="cafe-map-scale"
            aria-hidden="true"
            style={{ width: `${(100 / width) * 100}%` }}
          >
            100 m
          </div>
          {streetMarkers.map(({ letter, osmId, side, coordinate }) => (
            <span
              key={osmId}
              className="cafe-map-road-mark"
              data-osm-way={osmId}
              data-side={side}
              style={pointStyle(coordinate)}
              aria-hidden="true"
            >
              <span className="cafe-map-road-badge">{letter}</span>
            </span>
          ))}
          {places.map((place, index) => (
            <span
              className="cafe-map-place-dot"
              key={`${place.osmType}/${place.osmId}`}
              style={pointStyle(place)}
              aria-hidden="true"
            >
              {index + 1}
            </span>
          ))}
          {covered && (
            <span
              className="cafe-map-pin"
              data-dragging={dragging}
              style={pointStyle(current)}
              aria-hidden="true"
              onPointerDown={(event) => {
                if (pending || event.button !== 0 || !event.isPrimary) return;
                dragStart.current = {
                  spot: current,
                  x: event.clientX,
                  y: event.clientY,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragRevision(spotRevision);
              }}
              onPointerMove={movePin}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={() => {
                dragStart.current = null;
                setDragRevision(null);
              }}
            >
              <svg viewBox="0 0 32 42" focusable="false">
                <path d="M16 41C12 33 2 22 2 15a14 14 0 0 1 28 0c0 7-10 18-14 26Z" />
                <circle cx="16" cy="15" r="5" />
              </svg>
            </span>
          )}
        </div>
        <div className="cafe-map-street-key">
          <p id={streetKeyId}>Street key</p>
          <ul aria-labelledby={streetKeyId} role="list">
            {streetMarkers.map(({ letter, osmId, name }) => (
              <li key={osmId}>
                <span className="cafe-map-road-badge">{letter}</span>
                <span>{name}</span>
              </li>
            ))}
          </ul>
        </div>
        <figcaption>
          <a href={siteMap.attributionUrl}>{siteMap.attribution}</a>
          <span> · </span>
          <a href={siteMap.licenceUrl}>ODbL 1.0</a>
          <span> · </span>
          <a href={siteMap.sourceUrl}>
            Snapshot {siteMap.retrievedAt.slice(0, 10)}
          </a>
        </figcaption>
      </figure>

      <div className="cafe-map-selection" hidden={showStorefront}>
        <div aria-live={dragging ? "off" : "polite"} aria-atomic="true">
          <strong>{current.label}</strong>
          <p className="cafe-map-coordinates">
            <span>
              {current.lat.toFixed(6)}°, {current.lon.toFixed(6)}°
            </span>
            <Stamp tag={pinTag} />
          </p>
        </div>
        <button
          className="cafe-map-save"
          type="button"
          disabled={!dirty || pending}
          onClick={save}
        >
          {pending ? "Saving…" : dirty ? "Save spot" : "Spot saved"}
        </button>
      </div>
      <p className="cafe-map-hint" id={instructionId} hidden={showStorefront}>
        Tap the map or drag the pin. Use arrow keys to move it and Enter to
        save.
      </p>
      {error && (
        <p className="cafe-map-notice" role="alert" hidden={showStorefront}>
          {error}
        </p>
      )}

      <div className="cafe-map-nearby" hidden={showStorefront}>
        <h4>Nearby places</h4>
        {covered ? (
          <>
            <p className="cafe-map-hint">
              Closest mapped place in each category within {searchRadiusMetres}{" "}
              m. Distances are calculated in a straight line from the pin.
            </p>
            {places.length > 0 && (
              <ol>
                {places.map(
                  (
                    { osmType, osmId, name, category, distanceMetres },
                    index,
                  ) => (
                    <li key={`${osmType}/${osmId}`}>
                      <a
                        href={`https://www.openstreetmap.org/${osmType}/${osmId}`}
                      >
                        <span className="cafe-map-list-dot" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span>
                          {name}
                          <small>{category}</small>
                        </span>
                        <span className="cafe-map-distance">
                          <span>{distanceMetres} m</span>
                          <Stamp tag={pinTag} />
                        </span>
                      </a>
                    </li>
                  ),
                )}
              </ol>
            )}
            {missing.length > 0 && (
              <p className="cafe-map-notice">
                No mapped results within {searchRadiusMetres} m for{" "}
                {missing.join(", ")}.
              </p>
            )}
            {coverage === "partial" && (
              <p className="cafe-map-notice">
                Part of the search radius extends beyond this snapshot.
              </p>
            )}
          </>
        ) : (
          <p className="cafe-map-notice">
            The pin is outside the Indiranagar snapshot. Nearby data is
            unavailable for this location.
          </p>
        )}
        <p className="cafe-map-hint">
          Coverage is limited to the displayed area. OpenStreetMap may miss
          places or list outdated ones. Use these places as area context and
          enter your own demand.
        </p>
      </div>
    </section>
  );
}
