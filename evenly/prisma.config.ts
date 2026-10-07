import { defineConfig } from "prisma/config";

// The Prisma CLI doesn't read .env on its own; Next.js does for the app.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment (e.g. Docker).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://evenly:evenly@localhost:5433/evenly" },
});
