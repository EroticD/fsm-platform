import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` trenger ingen database. Docker-bygget kjører derfor
    // generate uten DATABASE_URL, mens migrate/status får den fra miljøet.
    url: process.env.DATABASE_URL ?? "",
  },
});
