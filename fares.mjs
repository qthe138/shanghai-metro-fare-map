const NEW_LIMITS = [4_000, 8_000, 12_000, 16_000, 23_000, 30_000, 40_000, 50_000];

export function newFare(meters) {
  const band = NEW_LIMITS.findIndex(limit => meters <= limit);
  return band >= 0 ? band + 3 : 10 + Math.ceil((meters - 50_000) / 15_000);
}

export function oldBaseFare(meters) {
  return 3 + Math.ceil(Math.max(0, meters - 6_000) / 10_000);
}

function pairKey(a, b) {
  return a < b ? a + "|" + b : b + "|" + a;
}

export function createFareModel(network) {
  const stations = network.stations;
  const indexById = new Map(stations.map((station, index) => [station.id, index]));
  const adjacency = stations.map(() => []);
  for (const [left, right, meters] of network.segments) {
    const a = indexById.get(left);
    const b = indexById.get(right);
    adjacency[a].push([b, meters]);
    adjacency[b].push([a, meters]);
  }

  const checkedFares = new Map(
    network.checkedFares.map(([a, b, old, current]) => [pairKey(a, b), { old, current }])
  );

  function from(originId) {
    const originIndex = indexById.get(originId);
    if (originIndex === undefined || stations[originIndex].separate) return new Map();
    const distances = new Float64Array(stations.length).fill(Infinity);
    const visited = new Uint8Array(stations.length);
    const values = new Map();

    distances[originIndex] = 0;
    for (let step = 0; step < stations.length; step++) {
      let nearest = -1;
      let shortest = Infinity;
      for (let index = 0; index < stations.length; index++) {
        if (!visited[index] && distances[index] < shortest) {
          nearest = index;
          shortest = distances[index];
        }
      }
      if (nearest < 0) break;
      visited[nearest] = 1;
      for (const [next, meters] of adjacency[nearest]) {
        const candidate = shortest + meters;
        if (candidate < distances[next]) distances[next] = candidate;
      }
    }

    stations.forEach((station, index) => {
      const meters = distances[index];
      if (station.id === originId || !Number.isFinite(meters)) return;
      const checked = checkedFares.get(pairKey(originId, station.id));
      const modeledOld = oldBaseFare(meters);

      const old = checked?.old ?? modeledOld;
      const current = checked?.current ?? newFare(meters);
      values.set(station.id, {
        current,
        old,
        change: current - old,
        verified: checked?.current != null,
        oldVerified: checked?.old != null,
      });
    });
    return values;
  }

  return { from };
}

const FARE_BANDS = [
  { id: "3", label: "3", color: "#087d66", test: value => value <= 3 },
  { id: "4–5", label: "4–5", color: "#276cac", test: value => value <= 5 },
  { id: "6–7", label: "6–7", color: "#694eac", test: value => value <= 7 },
  { id: "8–9", label: "8–9", color: "#ad5429", test: value => value <= 9 },
  { id: "10+", label: "10+", color: "#a03d62", test: () => true },
];

const CHANGE_BANDS = [
  { id: "down", label: "降价", color: "#087d66", test: value => value < 0 },
  { id: "0", label: "0", color: "#596b76", test: value => value === 0 },
  { id: "+1", label: "+1", color: "#276cac", test: value => value === 1 },
  { id: "+2", label: "+2", color: "#694eac", test: value => value === 2 },
  { id: "3+", label: "+3 及以上", color: "#a03d62", test: () => true },
];

export function bandsFor(mode) {
  return mode === "change" ? CHANGE_BANDS : FARE_BANDS;
}

export function bandFor(mode, fare) {
  const value = mode === "change" ? fare.change : fare.current;
  return bandsFor(mode).find(band => band.test(value));
}

export function fareLabel(mode, fare) {
  if (mode !== "change") return "¥" + fare.current;
  if (fare.change === 0) return "¥0";
  const sign = fare.change > 0 ? "+" : "−";
  return sign + "¥" + Math.abs(fare.change);
}
