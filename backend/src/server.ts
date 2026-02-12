import "dotenv/config";
import { app } from "./app";
import { ensureProductCatalog } from "./setup/productCatalog";

const PORT = Number(process.env.PORT ?? 3000);

async function startServer() {
  await ensureProductCatalog();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
