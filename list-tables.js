import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const apiKey = process.env.MCP_API_KEY || "";
  const transport = new SSEClientTransport(
    new URL("http://127.0.0.1:3000/sse" + (apiKey ? `?apiKey=${apiKey}` : ""))
  );

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  
  const response = await client.callTool({
    name: "list_databases",
    arguments: {}
  });
  
  console.log(response.content[0].text);
  process.exit(0);
}

main().catch(console.error);
