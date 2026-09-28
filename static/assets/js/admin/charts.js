import { escapeHtml, formatNumber } from "./utils.js";

function normalizeSeries(series) {
  return (series || []).map((entry) => ({
    date: String(entry?.date || ""),
    value: Number(entry?.value || 0),
  }));
}

function createPath(points) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function lineChart(seriesList = [], options = {}) {
  const width = 760;
  const height = 270;
  const padding = {
    top: 18,
    right: 18,
    bottom: 35,
    left: 46,
  };

  const normalized = seriesList.map((series) => ({
    name: series.name,
    data: normalizeSeries(series.data),
  }));

  const allValues = normalized.flatMap((series) =>
    series.data.map((entry) => entry.value),
  );

  const maxValue = Math.max(...allValues, 1);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const dataLength = Math.max(
    ...normalized.map((series) => series.data.length),
    1,
  );

  const yTicks = 4;
  const grid = [];

  for (let index = 0; index <= yTicks; index += 1) {
    const ratio = index / yTicks;
    const y = padding.top + plotHeight * ratio;
    const value = Math.round(maxValue * (1 - ratio));

    grid.push(`
      <line
        class="chart-grid-line"
        x1="${padding.left}"
        y1="${y}"
        x2="${width - padding.right}"
        y2="${y}"
      ></line>

      <text
        class="chart-axis-label"
        x="${padding.left - 9}"
        y="${y + 3}"
        text-anchor="end"
      >${escapeHtml(formatNumber(value))}</text>
    `);
  }

  const dateSource = normalized.find((series) => series.data.length > 0)?.data || [];
  const labelIndexes = [
    0,
    Math.floor((dateSource.length - 1) / 2),
    Math.max(0, dateSource.length - 1),
  ];

  const xLabels = [...new Set(labelIndexes)]
    .map((index) => {
      const entry = dateSource[index];

      if (!entry) return "";

      const x =
        padding.left +
        (index / Math.max(dateSource.length - 1, 1)) * plotWidth;

      const label = entry.date
        ? new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
          }).format(new Date(`${entry.date}T00:00:00Z`))
        : "";

      return `
        <text
          class="chart-axis-label"
          x="${x}"
          y="${height - 10}"
          text-anchor="${index === 0 ? "start" : index === dateSource.length - 1 ? "end" : "middle"}"
        >${escapeHtml(label)}</text>
      `;
    })
    .join("");

  const paths = normalized
    .map((series, seriesIndex) => {
      const points = series.data.map((entry, index) => ({
        x:
          padding.left +
          (index / Math.max(series.data.length - 1, 1)) * plotWidth,
        y:
          padding.top +
          plotHeight -
          (entry.value / maxValue) * plotHeight,
      }));

      const path = createPath(points);

      const area =
        seriesIndex === 0 && path
          ? `
            <path
              class="chart-area"
              d="${path} L ${points.at(-1)?.x || padding.left} ${padding.top + plotHeight} L ${points[0]?.x || padding.left} ${padding.top + plotHeight} Z"
            ></path>
          `
          : "";

      return `
        ${area}
        <path
          class="chart-series chart-series-${seriesIndex}"
          d="${path}"
        ></path>
      `;
    })
    .join("");

  const legend = normalized
    .map(
      (series, index) => `
        <span class="legend-item">
          <span class="legend-dot legend-dot-${index}"></span>
          ${escapeHtml(series.name)}
        </span>
      `,
    )
    .join("");

  return `
    <div class="chart-legend">${legend}</div>

    <div class="chart-wrap">
      <svg
        class="chart-svg"
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label="${escapeHtml(options.label || "Analytics chart")}"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chart-area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8190ff" stop-opacity="0.22"></stop>
            <stop offset="100%" stop-color="#8190ff" stop-opacity="0"></stop>
          </linearGradient>
        </defs>

        ${grid.join("")}
        ${paths}
        ${xLabels}
      </svg>
    </div>
  `;
}
