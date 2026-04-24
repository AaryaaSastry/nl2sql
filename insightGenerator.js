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
  if (!Array.isArray(results)) {
    return "Error: Database result was not an array. Please check the connection.";
  }

  if (results.length === 0) {
    return "No records were found matching this criteria.";
  }

  // Handle case where result is very large to avoid token overflow
  const maxResults = 50;
  const isTruncated = results.length > maxResults;
  const dataToProcess = results.slice(0, maxResults);

  const bulletPoints = dataToProcess.map((row, index) => {
    const details = Object.entries(row)
      .map(([key, val]) => {
        const title = key
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
        
        let formattedVal = val;
        // Basic formatting for numbers
        if (typeof val === 'number') {
          formattedVal = Number.isInteger(val) ? val.toLocaleString() : val.toFixed(2);
        }
        
        // Handle nulls
        if (val === null) formattedVal = "N/A";

        return `${title}: ${formattedVal}`;
      })
      .join(", ");

    return `• ${details}`;
  });

  let message = `Based on the database records (${results.length} found):\n\n${bulletPoints.join("\n")}`;
  if (isTruncated) {
    message += `\n\n(Showing first ${maxResults} results. Use specific filters for more targeted data.)`;
  }
  return message;
}
