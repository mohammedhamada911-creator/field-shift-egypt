/* Chart rendering for Field Shift Egypt. No data is ever fabricated: nulls stay gaps. */
(function () {
  "use strict";

  const registry = new Map();
  const COLORS = {
    green: "#173f35",
    green2: "#24594a",
    sage: "#6fa892",
    amber: "#d98b2b",
    clay: "#b6543b",
    blue: "#2f7185",
    grid: "rgba(63, 85, 76, 0.10)",
    text: "#3f554c",
    muted: "#6e7f77",
  };

  function formatDay(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  }

  function fullDay(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function baseOptions(yTitle, y2Title) {
    const scales = {
      x: {
        grid: { display: false },
        ticks: { color: COLORS.muted, maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } },
        border: { color: COLORS.grid },
      },
      y: {
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.muted, font: { size: 10 } },
        border: { display: false },
        title: { display: !!yTitle, text: yTitle, color: COLORS.muted, font: { size: 10 } },
      },
    };
    if (y2Title) {
      scales.y1 = {
        position: "right",
        grid: { drawOnChartArea: false },
        ticks: { color: COLORS.muted, font: { size: 10 } },
        border: { display: false },
        title: { display: true, text: y2Title, color: COLORS.muted, font: { size: 10 } },
      };
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: { duration: 450 },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: {
            color: COLORS.text,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "circle",
            font: { size: 10, weight: "600" },
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: "#14251f",
          titleFont: { size: 11 },
          bodyFont: { size: 11 },
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            title: (items) => (items.length ? fullDay(items[0].label) : ""),
          },
        },
      },
      scales,
    };
  }

  function destroy(id) {
    if (registry.has(id)) {
      registry.get(id).destroy();
      registry.delete(id);
    }
  }

  function clearEmpty(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const wrap = canvas.parentElement;
    const old = wrap.querySelector(".chart-empty");
    if (old) old.remove();
    canvas.hidden = false;
    return canvas;
  }

  function showEmpty(id, message) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    destroy(id);
    const wrap = canvas.parentElement;
    canvas.hidden = true;
    let box = wrap.querySelector(".chart-empty");
    if (!box) {
      box = document.createElement("div");
      box.className = "chart-empty";
      wrap.appendChild(box);
    }
    box.textContent = message;
  }

  function valid(rows, key) {
    return rows.some((row) => row[key] !== null && row[key] !== undefined);
  }

  function renderTemperature(rows) {
    const id = "chart-temperature";
    if (!valid(rows, "T2M") && !valid(rows, "T2M_MAX") && !valid(rows, "T2M_MIN")) {
      showEmpty(id, "No valid temperature observations for this period. Missing values are not replaced with zero.");
      return;
    }
    const canvas = clearEmpty(id);
    destroy(id);
    const labels = rows.map((row) => row.date);
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Mean",
            data: rows.map((row) => row.T2M),
            borderColor: COLORS.green,
            backgroundColor: "rgba(23,63,53,.06)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            spanGaps: false,
          },
          {
            label: "Maximum",
            data: rows.map((row) => row.T2M_MAX),
            borderColor: COLORS.clay,
            borderWidth: 1.4,
            pointRadius: 0,
            tension: 0.2,
            spanGaps: false,
            borderDash: [4, 3],
          },
          {
            label: "Minimum",
            data: rows.map((row) => row.T2M_MIN),
            borderColor: COLORS.blue,
            borderWidth: 1.4,
            pointRadius: 0,
            tension: 0.2,
            spanGaps: false,
            borderDash: [4, 3],
          },
        ],
      },
      options: (() => {
        const opts = baseOptions("°C");
        opts.plugins.tooltip.callbacks.label = (ctx) =>
          `${ctx.dataset.label}: ${ctx.parsed.y === null ? "no data" : ctx.parsed.y.toFixed(1) + " °C"}`;
        return opts;
      })(),
    });
    registry.set(id, chart);
  }

  function renderWater(rows) {
    const id = "chart-water";
    if (!valid(rows, "PRECTOTCORR") && !valid(rows, "ALLSKY_SFC_SW_DWN")) {
      showEmpty(id, "No valid rainfall or solar-radiation observations for this period.");
      return;
    }
    const canvas = clearEmpty(id);
    destroy(id);
    const labels = rows.map((row) => row.date);
    const chart = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Precipitation (mm)",
            data: rows.map((row) => row.PRECTOTCORR),
            backgroundColor: "rgba(47,113,133,.55)",
            borderColor: COLORS.blue,
            borderWidth: 0,
            borderRadius: 2,
            yAxisID: "y",
            barPercentage: 0.82,
            categoryPercentage: 0.9,
          },
          {
            type: "line",
            label: "Solar radiation (kWh/m²/d)",
            data: rows.map((row) => row.ALLSKY_SFC_SW_DWN),
            borderColor: COLORS.amber,
            backgroundColor: "rgba(217,139,43,.08)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            spanGaps: false,
            yAxisID: "y1",
          },
        ],
      },
      options: (() => {
        const opts = baseOptions("mm/day", "kWh/m²/day");
        opts.plugins.tooltip.callbacks.label = (ctx) => {
          const value = ctx.parsed.y;
          if (value === null || value === undefined) return `${ctx.dataset.label}: no data`;
          const unit = ctx.dataset.type === "bar" ? " mm" : " kWh/m²/d";
          return `${ctx.dataset.label.split(" (")[0]}: ${value.toFixed(2)}${unit}`;
        };
        return opts;
      })(),
    });
    registry.set(id, chart);
  }

  function renderSoil(rows) {
    const id = "chart-soil";
    if (!valid(rows, "GWETROOT") && !valid(rows, "RH2M")) {
      showEmpty(id, "No valid root-zone wetness or humidity observations for this period.");
      return;
    }
    const canvas = clearEmpty(id);
    destroy(id);
    const labels = rows.map((row) => row.date);
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Root-zone wetness (0–1)",
            data: rows.map((row) => row.GWETROOT),
            borderColor: COLORS.green2,
            backgroundColor: "rgba(36,89,74,.10)",
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
            spanGaps: false,
            yAxisID: "y",
          },
          {
            label: "Relative humidity (%)",
            data: rows.map((row) => row.RH2M),
            borderColor: COLORS.blue,
            borderWidth: 1.4,
            pointRadius: 0,
            tension: 0.25,
            spanGaps: false,
            borderDash: [4, 3],
            yAxisID: "y1",
          },
        ],
      },
      options: (() => {
        const opts = baseOptions("wetness fraction", "%");
        opts.scales.y.suggestedMin = 0;
        opts.scales.y.suggestedMax = 1;
        opts.scales.y1.suggestedMin = 0;
        opts.scales.y1.suggestedMax = 100;
        opts.plugins.tooltip.callbacks.label = (ctx) => {
          const value = ctx.parsed.y;
          if (value === null || value === undefined) return `${ctx.dataset.label}: no data`;
          return ctx.dataset.yAxisID === "y1"
            ? `Humidity: ${value.toFixed(0)} %`
            : `Root-zone wetness: ${value.toFixed(3)}`;
        };
        return opts;
      })(),
    });
    registry.set(id, chart);
  }

  window.FieldShiftCharts = {
    renderTemperature,
    renderWater,
    renderSoil,
    destroyAll: () => {
      [...registry.keys()].forEach(destroy);
    },
    formatDay,
    fullDay,
  };
})();
