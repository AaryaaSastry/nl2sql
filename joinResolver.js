import { relations } from "./planConfig.js";

/**
 * Finds the shortest join path between a base table and a goal table using BFS.
 * @param {string} start - The initial table
 * @param {string} target - The table to reach
 * @returns {string[]} Ordered array of table names in the join path (excluding the start table)
 */
export function findJoinPath(start, target) {
  if (start === target) return [];

  // queue stores [currentTable, currentPath]
  const queue = [[start, []]];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const [current, path] = queue.shift();

    if (current === target) {
      return path;
    }

    const neighbors = relations[current] || {};
    for (const neighbor in neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }

  throw new Error(`No join path found between ${start} and ${target} in relations config.`);
}

/**
 * Expands a simple list of "requested" joins into a full transitive path.
 * e.g., if target is 'plans' and it joins only via 'customers', returns ['customers', 'plans'].
 */
export function resolveAllJoins(baseTable, requestedJoins) {
  const fullPathSet = new Set();
  
  for (const target of requestedJoins) {
    const path = findJoinPath(baseTable, target);
    path.forEach(t => fullPathSet.add(t));
  }
  
  return Array.from(fullPathSet);
}
