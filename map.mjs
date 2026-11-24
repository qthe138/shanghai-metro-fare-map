import { bandFor, fareLabel } from "./fares.mjs";

const MAP_BACKGROUND = "#f1f7f8";
const INK = "#23434b";
const MIN_SCALE = 0.84;
const MAX_SCALE = 12;
const LINE_FONT = '700 11px system-ui, sans-serif';
const LABEL_FONT = '600 12px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const FARE_FONT = '750 12px system-ui, sans-serif';

function clamp(value, lowest, highest) {
  return Math.max(lowest, Math.min(value, highest));
}

function makePath(points, closed) {
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) path.lineTo(x, y);
  if (closed) path.closePath();
  return path;
}

function contrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * .299 + g * .587 + b * .114) > 154 ? "#203436" : "#fff";
}

export class MetroMap {
  constructor(canvas, viewport, network, onSelect, onHover) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.context = canvas.getContext("2d");
    this.stations = network.stations;
    this.bounds = network.bounds;
    this.river = network.river ? new Path2D(network.river) : null;
    this.lines = network.lines.map(line => ({
      ...line,
      paths: line.paths.map(part => makePath(part.points, part.closed)),
    }));
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.pointers = new Map();
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;
    this.visibleStations = [];
    this.labels = [];

    this.attachEvents();
    new ResizeObserver(() => this.resize()).observe(viewport);
    this.resize();
  }

  setFares({ origin, destination, mode, filter, values }) {
    this.origin = origin;
    this.destination = destination;
    this.mode = mode;
    this.filter = filter;
    this.values = values;
    this.points = this.stations.map(station => {
      const fare = values.get(station.id);
      return { station, fare, band: fare ? bandFor(mode, fare) : null };
    });
    this.clearHover();
    this.requestDraw();
  }

  resize() {
    const { width, height } = this.viewport.getBoundingClientRect();
    if (!width || !height) return;
    const previousScale = this.scale;
    const previousCenterX = this.width / 2;
    const previousCenterY = this.height / 2;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);

    const [minX, minY, maxX, maxY] = this.bounds;
    const padding = width < 600 ? 18 : 32;
    this.baseScale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
    this.scale = this.baseScale * this.zoom;
    if (previousScale) {
      this.offsetX = width / 2 - (previousCenterX - this.offsetX) * this.scale / previousScale;
      this.offsetY = height / 2 - (previousCenterY - this.offsetY) * this.scale / previousScale;
    } else {
      this.fit();
    }
    this.requestDraw();
  }

  fit() {
    const [minX, minY, maxX, maxY] = this.bounds;
    this.zoom = 1;
    this.scale = this.baseScale;
    this.offsetX = this.width / 2 - ((minX + maxX) / 2) * this.scale;
    this.offsetY = this.height / 2 - ((minY + maxY) / 2) * this.scale;
    this.clearHover();
    this.requestDraw();
  }

  centerOn(station) {
    const focusScale = this.width < 600 ? 0.64 : 0.60;
    this.zoom = clamp(Math.max(this.zoom, focusScale / this.baseScale), MIN_SCALE, MAX_SCALE);
    this.scale = this.baseScale * this.zoom;
    this.offsetX = this.width / 2 - station.x * this.scale;
    this.offsetY = this.height / 2 - station.y * this.scale;
    this.clearHover();
    this.requestDraw();
  }

  zoomAt(factor, x = this.width / 2, y = this.height / 2, oldX = x, oldY = y) {
    const next = clamp(this.zoom * factor, MIN_SCALE, MAX_SCALE);
    const ratio = next / this.zoom;
    this.offsetX = x - (oldX - this.offsetX) * ratio;
    this.offsetY = y - (oldY - this.offsetY) * ratio;
    this.zoom = next;
    this.scale = this.baseScale * next;
    this.constrainPosition();
    this.clearHover();
    this.requestDraw();
  }

  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    this.constrainPosition();
    this.clearHover();
    this.requestDraw();
  }

  constrainPosition() {
    const [minX, minY, maxX, maxY] = this.bounds;
    this.offsetX = clamp(this.offsetX, this.width * .18 - maxX * this.scale, this.width * .82 - minX * this.scale);
    this.offsetY = clamp(this.offsetY, this.height * .18 - maxY * this.scale, this.height * .82 - minY * this.scale);
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  attachEvents() {
    const viewport = this.viewport;
    const position = event => {
      const rect = viewport.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    viewport.addEventListener("wheel", event => {
      event.preventDefault();
      const { x, y } = position(event);
      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      this.zoomAt(Math.exp(-clamp(step, -160, 160) * .003), x, y);
    }, { passive: false });

    viewport.addEventListener("pointerdown", event => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const point = position(event);
      if (this.pointers.size === 0) {
        this.press = { ...point, id: event.pointerId, moved: false };
      } else {
        this.press.moved = true;
      }
      this.pointers.set(event.pointerId, point);
      viewport.setPointerCapture(event.pointerId);
      this.clearHover();
      this.onHover(null);
    });

    viewport.addEventListener("pointermove", event => {
      const point = position(event);
      const last = this.pointers.get(event.pointerId);
      if (!last) {
        if (event.pointerType === "mouse" && this.pointers.size === 0) this.updateHover(point);
        return;
      }

      const partner = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      this.pointers.set(event.pointerId, point);
      if (partner) {
        this.press.moved = true;
        viewport.dataset.cursor = "drag";
        const oldDistance = Math.hypot(last.x - partner.x, last.y - partner.y);
        const newDistance = Math.hypot(point.x - partner.x, point.y - partner.y);
        if (oldDistance > 2) {
          this.zoomAt(newDistance / oldDistance, (point.x + partner.x) / 2, (point.y + partner.y) / 2,
            (last.x + partner.x) / 2, (last.y + partner.y) / 2);
        }
      } else if (this.press.moved || Math.hypot(point.x - this.press.x, point.y - this.press.y) > 5) {
        this.press.moved = true;
        viewport.dataset.cursor = "drag";
        this.pan(point.x - last.x, point.y - last.y);
      }
    });

    viewport.addEventListener("pointerup", event => {
      const point = position(event);
      const isClick = this.press?.id === event.pointerId && !this.press.moved;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size === 0) {
        this.press = null;
        delete viewport.dataset.cursor;
      }
      if (isClick) {
        const item = this.hit(point, event.pointerType === "touch" ? 16 : 11);
        if (item) this.onSelect(item.station, point);
      }
      if (event.pointerType === "mouse" && this.pointers.size === 0) this.updateHover(point);
    });

    const endPointer = event => {
      this.pointers.delete(event.pointerId);
      if (!this.pointers.size) {
        this.press = null;
        delete viewport.dataset.cursor;
      }
    };
    viewport.addEventListener("pointercancel", endPointer);
    viewport.addEventListener("lostpointercapture", endPointer);
    viewport.addEventListener("pointerleave", () => this.clearHover());
    viewport.addEventListener("keydown", event => {
      const moves = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
      if (moves[event.key]) {
        event.preventDefault();
        this.pan(...moves[event.key]);
      } else if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") this.fit();
        else this.zoomAt(event.key === "-" ? 1 / 1.35 : 1.35);
      }
    });
  }

  hit(point, radius) {
    const label = this.labels.find(label => point.x >= label.x && point.x <= label.x + label.w &&
      point.y >= label.y && point.y <= label.y + label.h);
    if (label) return label.item;
    let closest = null;
    let distance = radius;
    for (const item of this.visibleStations) {
      const next = Math.hypot(point.x - item.x, point.y - item.y);
      if (next < distance) {
        closest = item;
        distance = next;
      }
    }
    return closest;
  }

  updateHover(point) {
    const hit = this.hit(point, 10);
    if (!hit) return this.clearHover();
    this.hoverId = hit.station.id;
    this.viewport.dataset.cursor = "station";
    this.onHover(hit.station, point);
    this.requestDraw();
  }

  clearHover() {
    if (!this.hoverId) return;
    this.hoverId = null;
    if (!this.pointers.size) delete this.viewport.dataset.cursor;
    this.onHover(null);
    this.requestDraw();
  }

  draw() {
    if (!this.points || !this.scale) return;
    const ctx = this.context;
    const { width, height, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    this.drawGrid();
    this.drawLines();
    this.drawStations();
  }

  drawGrid() {
    const ctx = this.context;
    const step = 25;
    ctx.beginPath();
    for (let x = this.offsetX % step; x < this.width; x += step) {
      for (let y = this.offsetY % step; y < this.height; y += step) {
        ctx.rect(Math.round(x), Math.round(y), 1.15, 1.15);
      }
    }
    ctx.fillStyle = "#b4c9ce61";
    ctx.fill();
  }

  drawLines() {
    const ctx = this.context;
    const { scale } = this;
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (this.river) {
      ctx.lineWidth = clamp(55 * scale, 10, 50) / scale;
      ctx.strokeStyle = "#d7edf3";
      ctx.stroke(this.river);
    }

    const weight = clamp(3.9 + Math.log2(this.zoom) * 1.2, 3.4, 7.5);
    for (const line of this.lines) {
      ctx.strokeStyle = line.separate ? "#7a909b" : line.color;
      ctx.lineWidth = (line.separate ? weight * .62 : weight) / scale;
      ctx.setLineDash(line.separate ? [6 / scale, 5 / scale] : []);
      if (line.separate) ctx.globalAlpha = .81;
      for (const path of line.paths) ctx.stroke(path);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawStations() {
    const ctx = this.context;
    const visible = [];
    const byId = new Map();
    this.labels = [];
    const dotRadius = this.scale < .28 ? 2.45 : this.scale < .44 ? 3.05 : 3.9;
    const dotOutline = this.scale < .28 ? .8 : 1.15;
    for (const point of this.points) {
      const { station, band } = point;
      const x = station.x * this.scale + this.offsetX;
      const y = station.y * this.scale + this.offsetY;
      if (x < -25 || x > this.width + 25 || y < -25 || y > this.height + 25) continue;
      const origin = station.id === this.origin?.id;
      const active = station.id === this.destination?.id || station.id === this.hoverId;
      const dimmed = !origin && this.filter && band?.id !== this.filter;
      const color = origin ? "#124a43" : band?.color ?? "#617985";
      const radius = origin ? 7.7 : station.separate ? dotRadius - .5 : dotRadius + (station.lines.length > 1 ? .7 : 0);
      const item = { ...point, x, y, origin, active, dimmed, color, radius };
      visible.push(item);
      byId.set(station.id, item);
    }
    this.visibleStations = visible;

    for (const item of visible) {
      ctx.globalAlpha = item.dimmed ? .23 : 1;
      if (item.origin || item.active) {
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.radius + 4.3, 0, Math.PI * 2);
        ctx.fillStyle = item.origin ? "#1b987d39" : item.color + "42";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius + dotOutline, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
      ctx.fillStyle = item.color;
      ctx.fill();
      if (item.station.separate || item.origin) {
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.origin ? 2.5 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    const occupied = [];
    const keepMapPoint = item => !item.dimmed || item.active;
    const tags = visible
      .filter(keepMapPoint)
      .sort((a, b) => this.labelWeight(b) - this.labelWeight(a));
    const overview = this.scale < .37;
    const limit = overview ? (this.width < 600 ? 11 : 24) : Infinity;

    let rendered = 0;
    for (const item of tags) {
      if (rendered >= limit) break;
      if (overview && !item.origin && !item.active && !item.station.priority && !item.fare?.verified) continue;
      if (item.station.separate && !item.active && this.scale < .58) continue;
      if (this.drawStationLabel(item, occupied, visible)) rendered++;
    }
    this.drawLineBadges(occupied, byId);
  }

  labelWeight(item) {
    return (item.origin ? 300 : 0) + (item.active ? 150 : 0) +
      (item.fare?.verified ? 45 : 0) + (item.station.priority || 0) + Math.min(item.station.lines.length, 5);
  }

  drawStationLabel(item, occupied, points) {
    const ctx = this.context;
    const full = item.origin || item.active || this.scale >= .58 || Boolean(item.station.priority) || item.fare?.verified;
    const name = full ? item.station.shortName || item.station.name : "";
    const value = item.origin ? "起点" : item.fare ? fareLabel(this.mode, item.fare) : "单独计价";
    ctx.font = LABEL_FONT;
    const nameWidth = name ? ctx.measureText(name).width : 0;
    ctx.font = FARE_FONT;
    const valueWidth = ctx.measureText(value).width;
    const w = Math.ceil(nameWidth + valueWidth + (name ? 20 : 13));
    const h = 21;
    const gap = item.radius + 4;
    const candidates = [
      [item.x + gap, item.y - h / 2],
      [item.x - w / 2, item.y - gap - h],
      [item.x - gap - w, item.y - h / 2],
      [item.x - w / 2, item.y + gap],
      [item.x + 4, item.y + gap - 1],
      [item.x - w - 4, item.y + gap - 1],
    ];

    if (item.fare?.verified || (item.station.priority || 0) >= 21) {
      candidates.push(
        [item.x + 18, item.y - h - 20],
        [item.x - w - 18, item.y - h - 20],
        [item.x + 18, item.y + 23],
        [item.x - w - 18, item.y + 23],
      );
    }

    for (const [x, y] of candidates) {
      if (x < 2 || y < 2 || x + w > this.width - 2 || y + h > this.height - 2) continue;
      if (occupied.some(box => x < box.x + box.w + 2 && x + w + 2 > box.x &&
        y < box.y + box.h + 2 && y + h + 2 > box.y)) continue;
      if (!item.origin && !item.active && points.some(point => point !== item &&
        point.x > x - 2 && point.x < x + w + 2 && point.y > y - 2 && point.y < y + h + 2)) continue;

      const leaderX = clamp(item.x, x, x + w);
      const leaderY = clamp(item.y, y, y + h);
      if (Math.hypot(leaderX - item.x, leaderY - item.y) > 15) {
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.lineTo(leaderX, leaderY);
        ctx.strokeStyle = "#849ca5";
        ctx.lineWidth = .8;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 5);
      ctx.fillStyle = item.origin ? "#173f42" : "#fffffff5";
      ctx.fill();
      if (!item.origin) {
        ctx.lineWidth = .85;
        ctx.strokeStyle = item.active ? item.color : "#d5e3e7";
        ctx.stroke();
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      if (name) {
        ctx.font = LABEL_FONT;
        ctx.fillStyle = item.origin ? "#fff" : INK;
        ctx.fillText(name, x + 6, y + h / 2 + .2);
      }
      ctx.font = FARE_FONT;
      ctx.fillStyle = item.origin ? "#abe8d6" : item.color;
      ctx.fillText(value, x + (name ? nameWidth + 13 : 6), y + h / 2 + .2);
      occupied.push({ x, y, w, h });
      this.labels.push({ x, y, w, h, item });
      return true;
    }
    return false;
  }

  drawLineBadges(occupied, byId) {
    const ctx = this.context;
    ctx.font = LINE_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const line of this.lines) {
      for (const terminal of line.terminals) {
        const point = byId.get(terminal);
        if (!point) continue;
        const label = line.badge;
        const w = Math.max(17, Math.ceil(ctx.measureText(label).width + 10));
        const h = 16;
        const candidates = [[7, -h - 6], [-w - 7, -h - 6], [7, 7], [-w - 7, 7]];
        for (const [dx, dy] of candidates) {
          const x = point.x + dx;
          const y = point.y + dy;
          if (x < 3 || y < 3 || x + w > this.width - 3 || y + h > this.height - 3) continue;
          if (occupied.some(box => x < box.x + box.w + 3 && x + w + 3 > box.x &&
              y < box.y + box.h + 3 && y + h + 3 > box.y)) continue;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, 4);
          ctx.fillStyle = line.separate ? "#e3ecef" : line.color;
          ctx.fill();
          ctx.fillStyle = line.separate ? "#3e5966" : contrastColor(line.color);
          ctx.fillText(label, x + w / 2, y + h / 2 + .4);
          occupied.push({ x, y, w, h });
          break;
        }
      }
    }
  }
}
