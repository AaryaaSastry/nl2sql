import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // Assuming the server is running on localhost:3000
  // Provide the API key if you set MCP_API_KEY in the server's .env
  const apiKey = process.env.MCP_API_KEY || "";
  
  const transport = new SSEClientTransport(
    new URL("http://127.0.0.1:3000/sse" + (apiKey ? `?apiKey=${apiKey}` : ""))
  );

  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  });

  console.log("Connecting to MCP Server via SSE...");
  await client.connect(transport);
  console.log("Connected!");

  // List available tools
  console.log("\nFetching tools...");
  const tools = await client.listTools();
  console.log("Available Tools:");
  tools.tools.forEach(t => console.log(`- ${t.name}: ${t.description}`));

  // Perform a tool call (e.g., health_check or query_nl)
  console.log("\nExecuting 'health_check' tool...");
  try {
    const response = await client.callTool({
      name: "health_check",
      arguments: {}
    });
    
    console.log("Tool Response:");
    console.log(JSON.stringify(response.content, null, 2));
  } catch (error) {
    console.error("Error calling tool:", error);
  }

  // To test a query, uncomment below:
  /*
  console.log("\nExecuting 'query_nl' tool...");
  try {
    const response = await client.callTool({
      name: "query_nl",
      arguments: {
        db: "default",
        query: "What tables do we have?"
      }
    });
    console.log(JSON.stringify(response.content, null, 2));
  } catch (error) {
    console.error("Error calling query_nl:", error);
  }
  */
}

main().catch(console.error);
