/**
 * Custom Error Class for MCP specific failures.
 * Allows index.js to handle errors differently (e.g., returning formatted SQL instructions vs standard errors).
 */
export class McpError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = "McpError";
    this.code = code; // e.g., 'MISSING_RPC', 'VALIDATION_FAILED', 'SQL_INJECTION'
    this.details = details;
  }
}

/**
 * Enhanced logging with consistent metadata.
 */
export const logger = {
  info: (msg, meta = {}) => {
    console.error(`[INFO] ${msg}`, JSON.stringify(meta));
  },
  warn: (msg, meta = {}) => {
    console.error(`[WARN] ${msg}`, JSON.stringify(meta));
  },
  error: (msg, error) => {
    const errorDetails = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {})
    } : error;
    
    console.error(`[ERROR] ${msg}`, JSON.stringify(errorDetails));
  }
};
