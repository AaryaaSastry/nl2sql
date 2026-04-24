/**
 * Detects if a query implies a visual representation.
 */
function detectVisualType(query, results) {
  const q = query.toLowerCase();
  const keys = results.length > 0 ? Object.keys(results[0]) : [];
  
  // 1. Explicit requests
  if (q.includes("pie") || q.includes("breakdown") || q.includes("distribution")) return "pie";
  if (q.includes("chart") || q.includes("graph") || q.includes("bar") || q.includes("compare")) return "bar";
  if (q.includes("trend") || q.includes("over time") || q.includes("history")) return "line";

  // 2. Implicit heuristics
  if (results.length > 1 && results.length <= 15) {
    // If we have a clear "label" and "value" structure, it's a good candidate for a chart
    const hasNumeric = keys.some(k => typeof results[0][k] === 'number');
    const hasString = keys.some(k => typeof results[0][k] === 'string');
    
    if (hasNumeric && hasString) {
      if (results.length < 7) return "pie";
      return "bar";
    }
  }

  return null;
}

/**
 * Generates Mermaid.js code for a chart based on results.
 */
function generateMermaid(type, results) {
  if (results.length === 0) return "";
  
  const keys = Object.keys(results[0]);
  const labelKey = keys.find(k => typeof results[0][k] === 'string') || keys[0];
  const valueKey = keys.find(k => typeof results[0][k] === 'number') || keys[1];

  if (type === "pie") {
    let mermaid = "\n```mermaid\npie title Data Distribution\n";
    results.forEach(row => {
      const label = String(row[labelKey]).replace(/"/g, "'");
      const value = row[valueKey] || 0;
      mermaid += `    "${label}" : ${value}\n`;
    });
    mermaid += "```\n";
    return mermaid;
  }

  if (type === "bar" || type === "line") {
    // Mermaid xy-chart is newer and sometimes not supported, 
    // but bar chart is solid.
    let mermaid = "\n```mermaid\nbar-chart\n    title Analysis\n";
    const labels = results.map(row => row[labelKey]);
    const values = results.map(row => row[valueKey] || 0);
    
    mermaid += `    x-axis [${labels.map(l => `"${String(l).replace(/"/g, "'")}"`).join(", ")}]\n`;
    mermaid += `    y-axis "Value"\n`;
    mermaid += `    bar [${values.join(", ")}]\n`;
    mermaid += "```\n";
    return mermaid;
  }

  return "";
}

/**
 * Turns a JSON result set into bullet-point text and visual charts.
 */
export function generateInsights(results, queryPrompt = "") {
  if (!Array.isArray(results)) {
    return "Error: Database result was not an array. Please check the connection.";
  }

  if (results.length === 0) {
    return "No records were found matching this criteria.";
  }

  const visualType = detectVisualType(queryPrompt, results);
  const userWantsVisual = queryPrompt.toLowerCase().includes("yes") || 
                          queryPrompt.toLowerCase().includes("show") || 
                          queryPrompt.toLowerCase().includes("chart") ||
                          queryPrompt.toLowerCase().includes("graph");

  const mermaidCode = (visualType && userWantsVisual) ? generateMermaid(visualType, results) : "";
  const recommendation = (visualType && !userWantsVisual) 
    ? `\n\n📊 **AI Recommendation:** This data would look great as a **${visualType.toUpperCase()} CHART**. Would you like me to generate it? (Reply "Yes" or "Show chart")`
    : "";

  // Handle case where result is very large to avoid token overflow
  const maxResults = 50;
  const isTruncated = results.length > maxResults;
  const dataToProcess = results.slice(0, maxResults);

  const bulletPoints = dataToProcess.map((row) => {
    const details = Object.entries(row)
      .map(([key, val]) => {
        const title = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());

        let formattedVal = val;
        if (typeof val === 'number') {
          formattedVal = Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
        }
        if (val === null) formattedVal = "N/A";

        return `${title}: ${formattedVal}`;
      })
      .join(", ");

    return `• ${details}`;
  });

  let message = mermaidCode;
  message += `\n**Detailed Summary (${results.length} records found):**\n\n${bulletPoints.join("\n")}`;
  message += recommendation;
  
  if (isTruncated) {
    message += `\n\n(Showing first ${maxResults} results. Use specific filters for more targeted data.)`;
  }
  
  return message;
}