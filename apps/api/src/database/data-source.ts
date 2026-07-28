import "reflect-metadata";
import "../env";
import { DataSource } from "typeorm";
import { join } from "path";
import * as entities from "./entities";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

export default new DataSource({
  type: "postgres",
  url: DATABASE_URL,
  entities: Object.values(entities),
  migrations: [join(__dirname, "migrations/*.{ts,js}")],
  synchronize: false,
  logging: false,
});
