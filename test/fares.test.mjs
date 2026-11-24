import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createFareModel, newFare, oldBaseFare } from "../dist/fares.mjs";

const network = JSON.parse(readFileSync(new URL("../dist/network.json", import.meta.url)));
const model = createFareModel(network);
const stationByName = new Map(network.stations.map(station => [station.name, station]));
const metroStations = network.stations.filter(station => !station.separate);

test("each boundary is included in the lower new ticket band", () => {
  const limits = [4_000, 8_000, 12_000, 16_000, 23_000, 30_000, 40_000, 50_000, 65_000, 80_000];
  limits.forEach((limit, index) => {
    assert.equal(newFare(limit), index + 3);
    assert.equal(newFare(limit + 1), index + 4);
  });
  assert.equal(oldBaseFare(6_000), 3);
  assert.equal(oldBaseFare(6_001), 4);
  assert.equal(oldBaseFare(16_000), 4);
  assert.equal(oldBaseFare(16_001), 5);
});

test("announced old and new example fares agree in both directions", () => {
  const examples = [
    ["虹桥火车站", "南京东路", 5, 7],
    ["人民广场", "陆家嘴", 3, 3],
    ["西岑", "滴水湖", 15, 15],
  ];
  const calculated = createFareModel({ ...network, checkedFares: [] });
  for (const [departure, arrival, old, current] of examples) {
    const a = stationByName.get(departure).id;
    const b = stationByName.get(arrival).id;
    for (const [start, end] of [[a, b], [b, a]]) {
      assert.deepEqual(model.from(start).get(end), {
        current, old, change: current - old, verified: true, oldVerified: true,
      });
      const unverified = calculated.from(start).get(end);
      assert.deepEqual([unverified.old, unverified.current], [old, current]);
    }
  }
});

test("all 414 metro stops are connected, with separate fares outside the graph", () => {
  assert.equal(network.lines.filter(line => !line.separate).length, 19);
  assert.equal(network.lines.filter(line => line.separate).length, 3);
  assert.equal(metroStations.length, 414);
  assert.equal(new Set(network.stations.map(station => station.id)).size, network.stations.length);
  const separate = network.stations.filter(station => station.separate);
  for (const origin of metroStations) {
    const fares = model.from(origin.id);
    assert.equal(fares.size, metroStations.length - 1, origin.name);
    assert.ok(!fares.has(origin.id));
    for (const station of separate) assert.ok(!fares.has(station.id));
  }
  assert.equal(model.from(stationByName.get("金山卫").id).size, 0);
});

test("current stations and same-name non-transfer stations keep their own identities", () => {
  assert.ok(stationByName.get("蟠祥路·国家会计学院").lines.includes("2"));
  assert.ok(stationByName.get("康文路").lines.includes("18"));
  assert.ok(stationByName.get("呼兰路").lines.includes("18"));
  assert.ok(!stationByName.has("江杨南路"));
  assert.ok(!stationByName.has("浦东3号航站楼"));
  const line2 = stationByName.get("国家会展中心（2号线）");
  const line17 = stationByName.get("国家会展中心（17号线）");
  assert.notEqual(line2.id, line17.id);
  assert.notDeepEqual([line2.x, line2.y], [line17.x, line17.y]);
});
