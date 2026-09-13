export function registerGracefulShutdown(
  app: { close: () => Promise<void> },
  processRef = process,
) {
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; closing gateway gracefully.`);
    await app.close();
    if (typeof processRef.exit === "function") {
      processRef.exit(0);
    }
  };

  processRef.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  processRef.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
