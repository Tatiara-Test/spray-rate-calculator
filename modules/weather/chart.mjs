import { compassDirection } from "./provider.mjs";

export function drawWindChart(canvas, points, days = 1) {
  const context = canvas?.getContext?.("2d");
  if (!context) return;
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(300, canvas.clientWidth || 640);
  const height = Math.max(260, canvas.clientHeight || 320);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const selected = points.slice(0, days * 24);
  const margin = { left: 42, right: 16, top: 22, bottom: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const max = Math.max(20, ...selected.map((point) => Math.max(point.windSpeed || 0, point.windGust || 0)));
  context.font = "12px Arial";
  context.strokeStyle = "#d5ddd4";
  context.fillStyle = "#5c685f";
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = margin.top + plotHeight * (step / 4);
    const value = Math.round(max * (1 - step / 4));
    context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
    context.fillText(`${value}`, 8, y + 4);
  }
  selected.forEach((point, index) => {
    const date = new Date(point.time);
    if (date.getHours() >= 18 || date.getHours() < 6) {
      const x = margin.left + plotWidth * (index / Math.max(1, selected.length - 1));
      context.fillStyle = "rgba(35,107,56,.045)";
      context.fillRect(x, margin.top, plotWidth / Math.max(1, selected.length), plotHeight);
    }
  });
  const drawSeries = (key, colour, dashed = false) => {
    context.strokeStyle = colour; context.lineWidth = key === "windSpeed" ? 3 : 1.5; context.setLineDash(dashed ? [5, 4] : []);
    context.beginPath();
    selected.forEach((point, index) => {
      const x = margin.left + plotWidth * (index / Math.max(1, selected.length - 1));
      const y = margin.top + plotHeight * (1 - (point[key] || 0) / max);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke(); context.setLineDash([]);
  };
  drawSeries("windGust", "#8da694", true);
  drawSeries("windSpeed", "#236b38");
  selected.forEach((point, index) => {
    if (index % Math.max(2, Math.floor(selected.length / 18)) !== 0) return;
    const x = margin.left + plotWidth * (index / Math.max(1, selected.length - 1));
    const y = margin.top + plotHeight * (1 - (point.windSpeed || 0) / max);
    context.save(); context.translate(x, y); context.rotate(((point.windDirection || 0) + 180) * Math.PI / 180);
    context.fillStyle = "#69a52c"; context.beginPath(); context.moveTo(0, -8); context.lineTo(5, 5); context.lineTo(0, 2); context.lineTo(-5, 5); context.closePath(); context.fill(); context.restore();
  });
  context.fillStyle = "#5c685f";
  context.fillText("Wind speed (km/h) — gusts dashed", margin.left, height - 12);
  canvas.setAttribute("aria-label", `${days}-day forecast wind chart. First point ${compassDirection(selected[0]?.windDirection)} ${Math.round(selected[0]?.windSpeed || 0)} kilometres per hour.`);
}

