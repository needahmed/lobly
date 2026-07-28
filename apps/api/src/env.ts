import { config as loadEnv } from "dotenv";
import { join } from "path";

// Must be imported first from main.ts so process.env is populated
// before AppModule's fail-fast required-env check runs.
loadEnv({ path: join(__dirname, "../.env") });
