#!/usr/bin/env python3
import argparse
from datetime import datetime
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import xml.etree.ElementTree as ET


ROAD_TYPES = {
    **dict.fromkeys(("primary", "secondary", "tertiary", "secondary_link", "tertiary_link"), "main"),
    **dict.fromkeys(("residential", "service", "living_street", "unclassified"), "street"),
    **dict.fromkeys(("footway", "path", "pedestrian", "steps", "cycleway"), "path"),
}
PLACE_AMENITIES = {
    "cafe": ("food", "Café"),
    "college": ("education", "College"),
    "university": ("education", "University"),
}
ANCHORS = [
    ("12th Main & 5th Cross", "12th-main", 736207641),
    ("6th Main & Double Road", "6th-main", 1282881141),
    ("Near Indiranagar Metro", "metro", 6400857551),
]


def tags(element):
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}


def place_kind(tag):
    amenities = tag.get("amenity", "").split(";")
    for amenity in amenities:
        if amenity in PLACE_AMENITIES:
            return PLACE_AMENITIES[amenity]
    if tag.get("railway") == "station" and tag.get("station") == "subway":
        return ("transit", "Metro station")
    if tag.get("highway") == "bus_stop":
        return ("transit", "Bus stop")
    if "office" in tag or tag.get("amenity") == "coworking_space":
        return ("office", "Office")
    return None


def geometry_kind(tag):
    if tag.get("highway") in ROAD_TYPES:
        return ROAD_TYPES[tag["highway"]]
    if tag.get("railway") == "subway":
        return "rail"
    if tag.get("leisure") in ("park", "garden", "playground", "pitch"):
        return "green"
    if "building" in tag and tag["building"] != "no":
        return "building"
    return None


def representative_point(points):
    if len(points) == 1:
        return points[0]
    vertices = points[:-1] if points[0] == points[-1] else points
    return tuple(round(sum(axis) / len(vertices), 7) for axis in zip(*vertices))


def write_snapshot(output, metadata, places, features):
    lines = json.dumps(metadata, ensure_ascii=False, indent=2).splitlines()
    lines[-2] += ","
    lines = lines[:-1]
    for name, values in (("places", places), ("features", features)):
        lines.append(f'  "{name}": [')
        lines.extend(
            f"    {json.dumps(value, ensure_ascii=False, separators=(',', ':'))}{',' if index < len(values) - 1 else ''}"
            for index, value in enumerate(values)
        )
        lines.append("  ]," if name == "places" else "  ]")
    lines.append("}")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Build the licensed Indiranagar map extract from an OSM map API XML snapshot.")
    parser.add_argument("xml", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--check-amenities", type=Path)
    args = parser.parse_args()

    timestamp = datetime.fromisoformat(args.retrieved_at.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        parser.error("--retrieved-at needs a time zone")
    root = ET.parse(args.xml).getroot()
    if root.tag != "osm" or "opendatacommons.org/licenses/odbl/1-0/" not in root.get("license", ""):
        parser.error("Expected an ODbL-licensed OpenStreetMap XML export")
    raw_bounds = root.find("bounds").attrib
    west, south, east, north = (float(raw_bounds[key]) for key in ("minlon", "minlat", "maxlon", "maxlat"))
    source = urlparse(args.source_url)
    source_bbox = parse_qs(source.query).get("bbox", [""])[0]
    if (
        (source.scheme, source.netloc, source.path) != ("https", "api.openstreetmap.org", "/api/0.6/map")
        or tuple(float(value) for value in source_bbox.split(",") if value) != (west, south, east, north)
    ):
        parser.error("The OpenStreetMap API source URL must match the XML bounds")

    def inside(point):
        lon, lat = point
        return west <= lon <= east and south <= lat <= north

    nodes = {
        int(node.attrib["id"]): (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    if args.check_amenities:
        saved = json.loads(args.check_amenities.read_text(encoding="utf-8"))
        for place in saved["places"]:
            if place["osmType"] != "node" or nodes.get(place["osmId"]) != (place["lon"], place["lat"]):
                parser.error(f'Coordinates differ from saved amenity node {place["osmId"]}')

    places = []
    features = []
    for element in root:
        if element.tag not in ("node", "way"):
            continue
        tag = tags(element)
        kind = geometry_kind(tag) if element.tag == "way" else None
        category = place_kind(tag) if tag.get("name") else None
        if not (kind or category):
            continue
        osm_id = int(element.attrib["id"])
        if element.tag == "node":
            points = [nodes[osm_id]]
        else:
            points = [nodes.get(int(ref.attrib["ref"])) for ref in element.findall("nd")]
            if len(points) < 2 or any(point is None for point in points):
                continue
        if kind and any(inside(point) for point in points):
            features.append({"osmId": osm_id, "kind": kind, "name": tag.get("name"), "points": points})
        if category:
            point = representative_point(points)
            if inside(point):
                group, label = category
                places.append({
                    "osmType": element.tag,
                    "osmId": osm_id,
                    "name": tag["name"],
                    "group": group,
                    "category": label,
                    "lon": point[0],
                    "lat": point[1],
                })

    anchors = []
    for label, id, osm_id in ANCHORS:
        if osm_id not in nodes or not inside(nodes[osm_id]):
            parser.error(f"Expected site anchor {osm_id} inside the snapshot")
        lon, lat = nodes[osm_id]
        anchors.append({"id": id, "label": label, "osmType": "node", "osmId": osm_id, "lat": lat, "lon": lon})
    metadata = {
        "name": "Indiranagar, Bengaluru",
        "sourceUrl": args.source_url,
        "retrievedAt": args.retrieved_at,
        "attribution": "© OpenStreetMap contributors",
        "attributionUrl": "https://www.openstreetmap.org/copyright",
        "licence": "Open Database License (ODbL) 1.0",
        "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "anchors": anchors,
    }
    write_snapshot(args.output, metadata, places, features)
    print(f"{len(places)} named OSM places, {len(features)} OSM ways, {len(anchors)} site anchors")


if __name__ == "__main__":
    main()
