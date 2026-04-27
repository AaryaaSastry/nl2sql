/**
 * Visualization Service
 * 
 * Generates Chart.js configs from raw database results
 * Works standalone without requiring AI for chart generation
 */

/**
 * Detect chart type from query intent
 */
function detectChartType(query, results) {
  const queryLower = query.toLowerCase();

  // Pie chart indicators
  if (
    queryLower.includes("pie") ||
    queryLower.includes("distribution") ||
    queryLower.includes("breakdown") ||
    queryLower.includes("composition")
  ) {
    return "pie";
  }

  // Line chart indicators
  if (
    queryLower.includes("trend") ||
    queryLower.includes("over time") ||
    queryLower.includes("growth") ||
    queryLower.includes("timeline")
  ) {
    return "line";
  }

  // Bar chart (default for comparisons)
  if (
    queryLower.includes("compare") ||
    queryLower.includes("by") ||
    queryLower.includes("vs") ||
    queryLower.includes("across")
  ) {
    return "bar";
  }

  // Detect from data structure
  if (results.length > 0) {
    const firstRow = results[0];
    const numericCols = Object.keys(firstRow).filter(
      (k) => typeof firstRow[k] === "number"
    );
    const textCols = Object.keys(firstRow).filter(
      (k) => typeof firstRow[k] === "string"
    );

    // If many text columns, likely pie/doughnut
    if (textCols.length >= 1 && numericCols.length === 1) {
      return "pie";
    }

    // If has date/time column, use line
    if (
      Object.keys(firstRow).some(
        (k) => k.includes("date") || k.includes("time")
      )
    ) {
      return "line";
    }

    // Default: bar
    return "bar";
  }

  return "bar";
}

/**
 * Extract labels and values from results
 */
function extractDataFromResults(results, chartType) {
  if (!results || results.length === 0) {
    return { labels: [], data: [] };
  }

  const firstRow = results[0];
  const keys = Object.keys(firstRow);

  // Find the label column (usually first string/categorical)
  let labelKey = null;
  let valueKey = null;

  // Priority: find numeric and string columns
  const numericCols = keys.filter((k) => typeof firstRow[k] === "number");
  const stringCols = keys.filter((k) => typeof firstRow[k] === "string");
  const dateCols = keys.filter(
    (k) => k.includes("date") || k.includes("time")
  );

  if (dateCols.length > 0) {
    labelKey = dateCols[0];
  } else if (stringCols.length > 0) {
    labelKey = stringCols[0];
  } else {
    labelKey = keys[0];
  }

  // Value key: prefer numeric column
  if (numericCols.length > 0) {
    valueKey = numericCols[0];
  } else if (keys.length > 1) {
    valueKey = keys[1];
  } else {
    valueKey = keys[0];
  }

  const labels = results.map((row) => {
    const val = row[labelKey];
    if (typeof val === "string") return val.substring(0, 30); // Truncate long labels
    if (typeof val === "number") return val.toString();
    if (val instanceof Date) return val.toLocaleDateString();
    return String(val);
  });

  const data = results.map((row) => {
    const val = row[valueKey];
    if (typeof val === "number") return val;
    return parseInt(val) || 0;
  });

  return { labels, data, labelKey, valueKey };
}

/**
 * Generate Chart.js config for pie/doughnut
 */
function generatePieChart(results, query) {
  const { labels, data } = extractDataFromResults(results, "pie");

  const colors = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", 
    "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1"
  ];

  return {
    type: "pie",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors.slice(0, data.length),
          borderColor: "#1a1a1a",
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 20,
            font: { size: 12, family: "Inter" },
            color: "#ececec",
            boxWidth: 15,
          },
        },
        title: {
          display: true,
          text: "Distribution Analysis",
          font: { size: 16, weight: "600", family: "Inter" },
          color: "#ececec",
          padding: 20,
        },
      },
    },
  };
}

/**
 * Generate Chart.js config for bar chart
 */
function generateBarChart(results, query) {
  const { labels, data } = extractDataFromResults(results, "bar");

  return {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Value",
          data: data,
          backgroundColor: "#3b82f6",
          borderColor: "#2563eb",
          borderWidth: 1,
          borderRadius: 8,
          hoverBackgroundColor: "#60a5fa",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: labels.length > 10 ? "y" : "x",
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "Comparative Analysis",
          font: { size: 16, weight: "600", family: "Inter" },
          color: "#ececec",
          padding: 20,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255, 255, 255, 0.1)" },
          ticks: { color: "#b4b4b4", font: { size: 11 } },
        },
        x: {
          grid: { display: false },
          ticks: { color: "#b4b4b4", font: { size: 11 } },
        },
      },
    },
  };
}

/**
 * Generate Chart.js config for line chart
 */
function generateLineChart(results, query) {
  const { labels, data } = extractDataFromResults(results, "line");

  return {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Trend",
          data: data,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 3,
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: "#3b82f6",
          pointBorderColor: "#1a1a1a",
          pointBorderWidth: 2,
          hoverPointRadius: 7,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "Trend Analysis",
          font: { size: 16, weight: "600", family: "Inter" },
          color: "#ececec",
          padding: 20,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255, 255, 255, 0.1)" },
          ticks: { color: "#b4b4b4", font: { size: 11 } },
        },
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#b4b4b4", font: { size: 11 } },
        },
      },
    },
  };
}

/**
 * Main visualization generator
 * Returns Chart.js config ready to render
 */
export function generateVisualization(query, results) {
  if (!results || results.length === 0) {
    return null;
  }

  const chartType = detectChartType(query, results);

  let config;
  switch (chartType) {
    case "pie":
      config = generatePieChart(results, query);
      break;
    case "line":
      config = generateLineChart(results, query);
      break;
    case "bar":
    default:
      config = generateBarChart(results, query);
  }

  return config;
}

/**
 * Generate summary statistics table
 */
export function generateSummaryStats(results) {
  if (!results || results.length === 0) {
    return null;
  }

  const stats = {
    totalRows: results.length,
    numericSummary: {},
  };

  const firstRow = results[0];
  Object.keys(firstRow).forEach((key) => {
    if (typeof firstRow[key] === "number") {
      const values = results.map((r) => r[key]).filter((v) => typeof v === "number");

      if (values.length > 0) {
        stats.numericSummary[key] = {
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        };
      }
    }
  });

  return stats;
}

/**
 * Format stats for display in Markdown
 */
export function formatStatsAsMarkdown(stats) {
  if (!stats) return "";

  let md = `\n### 📊 Summary Statistics\n\n`;
  md += `- Total Records: **${stats.totalRows}**\n`;

  Object.entries(stats.numericSummary).forEach(([key, values]) => {
    md += `- **${key}**: Sum=${Math.round(values.sum).toLocaleString()}, Avg=${Math.round(values.avg).toLocaleString()}, Range=[${values.min}, ${values.max}]\n`;
  });

  return md;
}
