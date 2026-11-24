import "server-only";
import neo4j, { type Driver } from "neo4j-driver";

export function graphConfigured() {
  return Boolean(process.env.NEO4J_URI?.trim());
}

export function graphCredentialsAvailable() {
  return graphConfigured() && Boolean(process.env.NEO4J_USERNAME?.trim() && process.env.NEO4J_PASSWORD);
}

export async function withGraph<T>(run: (driver: Driver, options: { database?: string }) => Promise<T>) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = process.env;
  if (!NEO4J_URI?.trim() || !NEO4J_USERNAME?.trim() || !NEO4J_PASSWORD) throw new Error("Graph configuration is incomplete");
  const database = NEO4J_DATABASE?.trim();
  const driver = neo4j.driver(NEO4J_URI.trim(), neo4j.auth.basic(NEO4J_USERNAME.trim(), NEO4J_PASSWORD), {
    connectionTimeout: 5000,
    connectionAcquisitionTimeout: 8000,
    maxTransactionRetryTime: 5000,
  });
  try {
    return await run(driver, database ? { database } : {});
  } finally {
    await driver.close();
  }
}

export function graphFailure(stage: string, error: unknown) {
  const code = error instanceof neo4j.Neo4jError && /^[\w.]+$/.test(error.code) ? error.code : undefined;
  console.warn("Knowledge graph operation failed", JSON.stringify({ stage, code }));
  if (code?.endsWith(".DatabaseNotFound")) return "The configured Neo4j database was not found. Check NEO4J_DATABASE on the server.";
  if (code?.includes(".Security.")) return "Neo4j rejected the connection or write permissions. Check the server’s graph access.";
  return "The knowledge graph could not complete the operation. Try again.";
}
