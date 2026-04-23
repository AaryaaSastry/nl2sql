/**
 * Generates data-driven insights from SQL results without hallucinating context.
 */

/**
 * Turns a JSON result set into bullet-point text.
 * @param {Array<Object>} results 
 * @param {string} queryPrompt - Optional original user query for context
 * @returns {string} 
 */
export function generateInsights(results, queryPrompt = "") {
  if (!Array.isArray(results) || results.length === 0) {
    return "No records were found matching this criteria.";
  }

  const bulletPoints = results.map((row, index) => {
    const details = Object.entries(row)
      .map(([key, val]) => {
        const formattedKey = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        
        let formattedVal = val;
        // Basic formatting for numbers
        if (typeof val === 'number') {
          formattedVal = Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
        }

        return `${formattedKey}: ${formattedVal}`;
      })
      .join(", ");

    return `• ${details}`;
  });

  return `Based on the database records:\n\n${bulletPoints.join("\n")}`;
}
