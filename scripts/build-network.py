#!/usr/bin/env python3
"""Build the site snapshot from downloaded station, schematic and mileage sources."""

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import pandas as pd


LINE_IDS = {f"{number}号线": str(number) for number in range(1, 19)}
LINE_IDS.update({"浦江线": "41", "市域机场线": "51", "磁浮线": "50"})
EXTRA_BADGES = {"41": "浦江", "50": "磁浮", "51": "机场线", "52": "金山"}
SEPARATE_LINES = {"50", "51", "52"}
POPULAR = [
    "南京东路", "人民广场", "陆家嘴", "上海火车站", "浦东1号2号航站楼",
    "虹桥2号航站楼", "徐家汇", "上海南站", "静安寺", "世纪大道", "龙阳路",
    "虹桥火车站", "五角场", "新天地", "迪士尼", "莘庄", "中山公园",
    "上海松江站", "康文路", "富锦路", "美兰湖", "滴水湖", "西岑", "花桥",
    "顾村公园", "东方体育中心", "金海路", "浦东南路",
]
ALIASES = {
    "虹桥火车站": ["虹桥站", "上海虹桥", "hongqiao railway station", "hq hcz"],
    "虹桥2号航站楼": ["虹桥机场", "虹桥T2"],
    "虹桥1号航站楼": ["虹桥T1"],
    "人民广场": ["人广", "people's square", "rmgc"],
    "南京东路": ["外滩", "东南京路", "east nanjing road", "njdl"],
    "陆家嘴": ["东方明珠", "ljz"],
    "浦东1号2号航站楼": ["浦东机场", "浦东国际机场", "浦东1号2号航站楼", "PVG"],
    "浦东南路": ["东昌路"],
    "向城路": ["浦电路4号线", "原浦电路"],
    "国家会展中心（2号线）": ["徐泾东", "国家会展中心2号线"],
    "国家会展中心（17号线）": ["诸光路", "国家会展中心17号线"],
    "蟠祥路·国家会计学院": ["蟠祥路", "国家会计学院"],
    "上海松江站": ["松江南站"],
}
JINSHAN = [
    ("上海南站", 1096, 1656), ("莘庄", 970, 1801),
    ("春申", 861, 1849), ("新桥", 733, 1933), ("车墩", 605, 2025),
    ("叶榭", 542, 2133), ("亭林", 515, 2249), ("金山园区", 511, 2355),
    ("金山卫", 434, 2518),
]
PUBLISHED_PAIRS = [
    ("虹桥火车站", "南京东路", 5, 7),
    ("人民广场", "陆家嘴", 3, 3),
    ("西岑", "滴水湖", 15, 15),
]

# Schematic waterway points aligned to the city-center river crossings.
RIVER = (
    "M 2570 388 C 2510 478 2372 536 2330 624 "
    "S 2367 795 2306 881 S 2178 945 2109 1028 "
    "S 2012 1143 1922 1154 C 1861 1163 1811 1183 1810 1233 "
    "S 1859 1346 1833 1410 S 1761 1518 1738 1570 "
    "S 1717 1728 1621 1773 S 1437 1782 1376 1830 "
    "S 1303 1988 1185 2053 S 1018 2182 1058 2250 "
    "S 1110 2322 1060 2380 S 958 2430 887 2515"
)


def station_name(name):
    name = re.sub(r"(?:\[.*?\]|注\s*\d+)", "", str(name)).strip()
    name = name.replace("(", "（").replace(")", "）").replace("•", "·")
    return {
        "浦东南路（原东昌路）": "浦东南路",
        "浦东国际机场": "浦东1号2号航站楼",
        "虹口足球場": "虹口足球场",
        "曲陽路": "曲阳路",
        "一大会址・黄陂南路": "一大会址·黄陂南路",
        "一大会址・新天地": "一大会址·新天地",
    }.get(name, name)


def mileage_tables(folder):
    tables = {}
    for line in [*(str(n) for n in range(1, 19)), "41"]:
        for table in pd.read_html(folder / f"metro-wiki-{line}.html"):
            names = [column for column in table.columns if str(column) in {"站名", "车站名称"}]
            distances = [column for column in table.columns if str(column).startswith("里程")]
            if not names or not distances or not any("站间距" in str(column) for column in table.columns):
                continue
            values = {}
            for name, value in zip(table[names[0]], table[distances[0]]):
                if pd.isna(name) or pd.isna(value):
                    continue
                text = str(value).replace(",", "").strip()
                match = re.fullmatch(r"([-\d]+)(?:\.0+)?(?:\s*\((\d+)\))?", text)
                if match:
                    values[station_name(name)] = tuple(int(part) for part in match.groups() if part is not None)
            tables[line] = values
            break
        if line not in tables:
            raise ValueError(f"Mileage table missing for line {line}")
    return tables


def interval_meters(line, a, b, table):
    if line in {"2", "17"}:
        a = a.split("（")[0]
        b = b.split("（")[0]
    pair = frozenset((a, b))
    if line == "4" and pair == {"宜山路", "上海体育馆"}:
        return table["宜山路"][1] - table["上海体育馆"][0]
    if line == "10" and pair == {"龙柏新村", "龙溪路"}:
        return table["龙溪路"][1] - table["龙柏新村"][0]
    if line == "11" and pair == {"上海赛车场", "嘉定新城"}:
        return table["嘉定新城"][1] - table["上海赛车场"][0]
    return abs(table[a][0] - table[b][0])


def station_xy(text):
    return [int(coordinate) for coordinate in text.split()]


def trim_open_path(raw, first, last):
    def nearest_index(point):
        return min(range(len(raw)), key=lambda i: sum((a - b) ** 2 for a, b in zip(point, raw[i])))

    start, end = nearest_index(first), nearest_index(last)
    if start > end:
        raw = raw[::-1]
        start, end = len(raw) - 1 - start, len(raw) - 1 - end
    points = [first, *raw[start : end + 1], last]
    return [point for index, point in enumerate(points) if index == 0 or point != points[index - 1]]


def build(folder):
    amap = json.loads((folder / "amap-shanghai.json").read_text())["l"]
    catalog = json.loads((folder / "metro-official-catalog.json").read_text())
    colors = {str(item["line_no"]): item["color"] for item in
              json.loads((folder / "metro-official-lines.json").read_text())}
    mileage = mileage_tables(folder)
    official_codes = {(str(int(item["key"][:2])), station_name(item["value"])): item["key"]
                      for item in catalog if not re.match(r"^[内外]圈", item["value"])}
    official_ids = set(official_codes.values())
    aligned_codes = set()
    stations = {}
    line_data = {}
    segments = {}
    ids_by_code = {}
    deferred_codes = defaultdict(list)

    def add_station(name, position, line, code, extra_search=""):
        if name not in stations:
            stations[name] = {"id": code, "name": name, "x": position[0], "y": position[1],
                              "lines": [], "search": [*ALIASES.get(name, [])]}
        station = stations[name]
        if line not in station["lines"]:
            station["lines"].append(line)
        if extra_search and extra_search not in station["search"]:
            station["search"].append(extra_search)
        if code:
            deferred_codes[name].append(code)
        if name in POPULAR:
            station["priority"] = len(POPULAR) - POPULAR.index(name)
        if name.startswith("国家会展中心（"):
            station["shortName"] = f"国家会展中心·{line}"
        return station

    raw_edges = []
    for branch in amap:
        line = LINE_IDS[branch["ln"]]
        if line not in line_data:
            line_data[line] = {
                "id": line, "name": branch["ln"], "color": colors.get(line, "#" + branch["cl"]),
                "separate": line in SEPARATE_LINES, "badge": EXTRA_BADGES.get(line, line),
                "paths": [], "terminals": [],
            }
        entry = line_data[line]
        names, positions = [], []
        for raw in branch["st"]:
            if raw["su"] != "1":
                raise ValueError(f"Unverified operating status for {raw['n']}")
            name = station_name(raw["n"])
            code = official_codes.get((line, name.split("（")[0]))
            if line != "50" and not code:
                raise ValueError(f"Unmatched station: line {line} {name}")
            if code:
                aligned_codes.add(code)
            position = station_xy(raw["p"])
            add_station(name, position, line, code, raw.get("sp", ""))
            positions.append(position)
            names.append(name)

        points = [station_xy(point) for point in branch["c"]]
        closed = branch["lo"] == "1"
        if not closed:
            points = trim_open_path(points, positions[0], positions[-1])
        entry["paths"].append({"points": points, "closed": closed})
        terminals = [names[0], names[-1]] if not closed else ["宜山路", "世纪大道"]
        entry["terminals"].extend(name for name in terminals if name not in entry["terminals"])
        if line in SEPARATE_LINES:
            continue
        adjacent = list(zip(names, names[1:]))
        if closed:
            adjacent.append((names[-1], names[0]))
        for a, b in adjacent:
            meters = interval_meters(line, a, b, mileage[line])
            if not 100 <= meters <= 12_000:
                raise ValueError(f"Unusual distance: line {line}, {a}–{b}: {meters} m")
            raw_edges.append((a, b, meters))

    if official_ids != aligned_codes:
        raise ValueError(f"Official station codes missing from schematic: {sorted(official_ids - aligned_codes)}")

    jinshan_points = []
    for index, (name, x, y) in enumerate(JINSHAN):
        add_station(name, [x, y], "52", f"J{index:02}")
        jinshan_points.append([x, y])
    line_data["52"] = {"id": "52", "name": "金山铁路", "color": "#64798e",
                       "separate": True, "badge": "金山",
                       "paths": [{"points": jinshan_points, "closed": False}],
                       "terminals": [JINSHAN[0][0], JINSHAN[-1][0]]}

    for name, station in stations.items():
        codes = deferred_codes[name]
        station["id"] = min(codes)
        station["lines"].sort(key=int)
        station["separate"] = all(line in SEPARATE_LINES for line in station["lines"])
        for code in codes:
            ids_by_code[code] = station["id"]
    for entry in line_data.values():
        entry["terminals"] = [stations[name]["id"] for name in entry["terminals"]]
    for a, b, meters in raw_edges:
        key = tuple(sorted((stations[a]["id"], stations[b]["id"])))
        segments[key] = min(meters, segments.get(key, meters))

    checked = {}
    legacy_path = folder / "metro-legacy-samples.json"
    if legacy_path.exists():
        for a, b, old in json.loads(legacy_path.read_text()):
            if old and a in ids_by_code and b in ids_by_code:
                checked[tuple(sorted((ids_by_code[a], ids_by_code[b])))] = [int(old), None]
    for a, b, old, current in PUBLISHED_PAIRS:
        checked[tuple(sorted((stations[a]["id"], stations[b]["id"])))] = [old, current]

    bounds = [
        min(station["x"] for station in stations.values()) - 10,
        min(station["y"] for station in stations.values()) - 12,
        max(station["x"] for station in stations.values()) + 10,
        max(station["y"] for station in stations.values()) + 12,
    ]
    return {
        "snapshot": "2026-11-25",
        "bounds": bounds,
        "river": RIVER,
        "stations": sorted(stations.values(), key=lambda item: item["id"]),
        "lines": sorted(line_data.values(), key=lambda item: (not item["separate"], int(item["id"]))),
        "segments": [[*key, meters] for key, meters in sorted(segments.items())],
        "checkedFares": [[*key, *amounts] for key, amounts in sorted(checked.items())],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = build(args.sources)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(data['stations'])} map stations, {len(data['lines'])} lines, "
          f"{len(data['segments'])} distance links, {len(data['checkedFares'])} checked station pairs")


if __name__ == "__main__":
    main()
