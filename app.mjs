import { bandsFor, bandFor, createFareModel, fareLabel } from "./fares.mjs";
import { MetroMap } from "./map.mjs";

const element = id => document.getElementById(id);
const originName = element("origin-name");
const originLines = element("origin-lines");
const originInput = element("origin-search");
const optionList = element("origin-options");
const destinationInput = element("destination-search");
const resultList = element("station-results");
const resultCount = element("result-count");
const filterSummary = element("filter-summary");
const viewport = element("map-viewport");
const loading = element("map-loading");
const tooltip = element("map-tooltip");
const announcement = element("announcement");
const legend = element("legend");
const dialog = element("info-dialog");
const modeControls = [...document.querySelectorAll("[data-mode]")];

element("open-info").addEventListener("click", () => dialog.showModal());
dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  }
});

function normalize(text) {
  return text.toLocaleLowerCase().replace(/[\s\-·（）()'’]+/g, "");
}

function orderStations(a, b) {
  return (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name, "zh-CN");
}

function listPrice(mode, fare) {
  const verified = mode === "change" ? fare.verified && fare.oldVerified : fare.verified;
  return (verified ? "" : "≈") + fareLabel(mode, fare);
}

function createApplication(network) {
  const lineById = new Map(network.lines.map(line => [line.id, line]));
  const stationById = new Map(network.stations.map(station => [station.id, station]));
  const rank = network.stations.map(station => ({
    ...station,
    terms: [station.name, ...station.search].map(normalize),
  })).sort(orderStations);
  const metroStations = rank.filter(station => !station.separate);
  const fareModel = createFareModel(network);
  const state = {
    mode: "fare",
    filter: null,
    origin: stationById.get("0235") ?? metroStations[0],
    destination: null,
    options: [],
    activeOption: -1,
  };
  state.values = fareModel.from(state.origin.id);

  const map = new MetroMap(element("map"), viewport, network, (station, point) => {
    if (station.separate) {
      showTooltip(station, point);
      announcement.textContent = station.name + "，" + separateName(station) + "单独计价";
    } else {
      chooseOrigin(station, false);
    }
  }, showTooltip);

  function separateName(station) {
    return station.lines.map(line => lineById.get(line).name).join("、");
  }

  function appendLineTags(element, station) {
    const tags = station.lines.map(id => {
      const line = lineById.get(id);
      const tag = document.createElement("span");
      tag.className = "line-tag";
      tag.textContent = line.name;
      tag.style.setProperty("--tag", line.color);
      return tag;
    });
    element.replaceChildren(...tags);
  }

  function matches(stations, term) {
    if (!term) return stations;
    const direct = [];
    const partial = [];
    for (const station of stations) {
      if (station.terms.some(text => text.startsWith(term))) direct.push(station);
      else if (station.terms.some(text => text.includes(term))) partial.push(station);
    }
    return [...direct, ...partial];
  }

  function chooseOrigin(station, center) {
    state.origin = station;
    state.destination = null;
    state.filter = null;
    state.values = fareModel.from(station.id);
    originInput.value = "";
    hideOptions();
    if (center) map.centerOn(station);
    updateOrigin();
    updateFilter();
    renderResults(true);
    updateMap();
    announcement.textContent = "起点已设为" + station.name + "，已更新" + state.values.size + "个目的站票价";
  }

  function updateOrigin() {
    originName.textContent = state.origin.name;
    appendLineTags(originLines, state.origin);
  }

  function showTooltip(station, point) {
    if (!station) {
      tooltip.hidden = true;
      return;
    }
    const fare = state.values.get(station.id);
    element("tooltip-station").textContent = station.name;
    element("tooltip-value").textContent = station.id === state.origin.id ? "起点" :
      fare ? listPrice(state.mode, fare) : "单独计价";
    tooltip.hidden = false;
    const x = Math.max(5, Math.min(point.x + 13, viewport.clientWidth - tooltip.offsetWidth - 5));
    const y = point.y > tooltip.offsetHeight + 15 ? point.y - tooltip.offsetHeight - 10 : point.y + 12;
    tooltip.style.transform = "translate(" + x + "px," + y + "px)";
  }

  function updateMap() {
    tooltip.hidden = true;
    map.setFares(state);
  }

  function hideOptions() {
    optionList.hidden = true;
    originInput.setAttribute("aria-expanded", "false");
    originInput.removeAttribute("aria-activedescendant");
    state.activeOption = -1;
  }

  function paintOptions() {
    const term = normalize(originInput.value);
    state.options = matches(metroStations, term).filter(station => station.id !== state.origin.id).slice(0, 10);
    state.activeOption = -1;
    const options = state.options.map(station => {
      const item = document.createElement("div");
      item.className = "suggestion";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.id = "option-" + station.id;
      item.dataset.station = station.id;
      const name = document.createElement("span");
      name.textContent = station.name;
      const tags = document.createElement("span");
      tags.className = "line-tags";
      appendLineTags(tags, station);
      item.append(name, tags);
      return item;
    });
    if (!options.length) {
      const empty = document.createElement("p");
      empty.className = "suggestion-empty";
      empty.textContent = "未找到起点站";
      options.push(empty);
    }
    optionList.replaceChildren(...options);
    optionList.hidden = false;
    originInput.setAttribute("aria-expanded", "true");
    originInput.removeAttribute("aria-activedescendant");
  }

  originInput.addEventListener("focus", paintOptions);
  originInput.addEventListener("input", paintOptions);
  originInput.addEventListener("blur", hideOptions);
  originInput.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      hideOptions();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (optionList.hidden) paintOptions();
      if (!state.options.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      state.activeOption = state.activeOption < 0 ? (delta > 0 ? 0 : state.options.length - 1) :
        (state.activeOption + delta + state.options.length) % state.options.length;
      [...optionList.children].forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === state.activeOption));
      });
      const active = optionList.children[state.activeOption];
      originInput.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !optionList.hidden && state.options.length) {
      event.preventDefault();
      chooseOrigin(state.options[Math.max(0, state.activeOption)], true);
    }
  });
  optionList.addEventListener("mousedown", event => event.preventDefault());
  optionList.addEventListener("click", event => {
    const option = event.target.closest("[data-station]");
    if (option) chooseOrigin(stationById.get(option.dataset.station), true);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || dialog.open ||
      event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    originInput.focus();
  });

  function renderResults(scrollToTop = false) {
    const term = normalize(destinationInput.value);
    const matchesList = matches(rank, term).filter(station => {
      if (station.id === state.origin.id) return false;
      if (!state.filter) return true;
      const fare = state.values.get(station.id);
      return fare && bandFor(state.mode, fare).id === state.filter;
    });

    const rows = matchesList.map(station => {
      const fare = state.values.get(station.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "result-row";
      row.dataset.station = station.id;
      row.setAttribute("aria-pressed", String(state.destination?.id === station.id));

      const left = document.createElement("span");
      const label = document.createElement("span");
      label.className = "result-name";
      label.textContent = station.name;
      const tags = document.createElement("span");
      tags.className = "line-tags";
      appendLineTags(tags, station);
      left.append(label, tags);

      const right = document.createElement("span");
      const price = document.createElement("span");
      price.className = fare ? "result-price" : "result-price separate-price";
      price.textContent = fare ? listPrice(state.mode, fare) : "单独计价";
      if (fare) {
        price.style.setProperty("--price", bandFor(state.mode, fare).color);
        price.title = price.textContent.startsWith("≈") ? "按区间里程测算" : "已核验的站间票价";
      }
      right.append(price);
      if (fare && state.mode === "change") {
        const old = document.createElement("span");
        old.className = "result-old";
        old.textContent = "旧 ¥" + fare.old + " · 新 ¥" + fare.current;
        right.append(old);
      }
      row.append(left, right);
      return row;
    });
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "没有符合条件的目的站";
      rows.push(empty);
    }
    resultList.replaceChildren(...rows);
    resultCount.textContent = term || state.filter ? matchesList.length + " 个结果" : state.values.size + " 站可查";
    if (scrollToTop) resultList.scrollTop = 0;
    element("results-footer").textContent = "单程基准票价 · ≈ 为里程测算";
  }

  destinationInput.addEventListener("input", () => renderResults(true));
  resultList.addEventListener("click", event => {
    const row = event.target.closest("[data-station]");
    if (!row) return;
    const station = stationById.get(row.dataset.station);
    state.destination = station;
    resultList.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
    row.setAttribute("aria-pressed", "true");
    map.centerOn(station);
    updateMap();
    const fare = state.values.get(station.id);
    announcement.textContent = station.name + "，" + (fare ? listPrice(state.mode, fare) : separateName(station) + "单独计价");
    if (matchMedia("(max-width: 760px)").matches) viewport.scrollIntoView({ block: "center" });
  });

  function updateFilter() {
    legend.querySelectorAll("[data-band]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.band === state.filter));
    });
    filterSummary.hidden = !state.filter;
    if (state.filter) {
      const title = bandsFor(state.mode).find(band => band.id === state.filter).label;
      filterSummary.textContent = (state.mode === "fare" ? "票价 " : "涨幅 ") + title + (title === "降价" ? "" : " 元");
    }
  }

  function renderLegend() {
    element("legend-title").textContent = state.mode === "fare" ? "票价（元）" : "涨幅（元）";
    const buttons = bandsFor(state.mode).map(band => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "legend-button";
      button.dataset.band = band.id;
      button.setAttribute("aria-label", (state.mode === "fare" ? "筛选票价 " : "筛选涨幅 ") + band.label);
      button.setAttribute("aria-pressed", "false");
      const swatch = document.createElement("i");
      swatch.style.setProperty("--swatch", band.color);
      swatch.setAttribute("aria-hidden", "true");
      button.append(swatch, document.createTextNode(band.label));
      return button;
    });
    legend.replaceChildren(...buttons);
    updateFilter();
  }

  legend.addEventListener("click", event => {
    const button = event.target.closest("[data-band]");
    if (!button) return;
    state.filter = state.filter === button.dataset.band ? null : button.dataset.band;
    updateFilter();
    renderResults(true);
    updateMap();
  });
  for (const button of modeControls) {
    button.addEventListener("click", () => {
      if (state.mode === button.dataset.mode) return;
      state.mode = button.dataset.mode;
      state.filter = null;
      for (const control of modeControls) control.setAttribute("aria-pressed", String(control === button));
      renderLegend();
      renderResults(true);
      updateMap();
    });
  }

  element("zoom-in").addEventListener("click", () => map.zoomAt(1.45));
  element("zoom-out").addEventListener("click", () => map.zoomAt(1 / 1.45));
  element("reset-map").addEventListener("click", () => map.fit());
  element("focus-origin").addEventListener("click", () => map.centerOn(state.origin));

  const status = element("map-data-status");
  status.textContent = "票价测算";
  status.hidden = false;
  loading.hidden = true;
  updateOrigin();
  renderLegend();
  renderResults();
  updateMap();
}

try {
  const response = await fetch("./network.json");
  if (!response.ok) throw new Error("Line data is unavailable (" + response.status + ")");
  createApplication(await response.json());
} catch (error) {
  loading.textContent = "线网数据加载失败，请刷新重试。";
  originInput.disabled = true;
  destinationInput.disabled = true;
  console.error(error);
}
