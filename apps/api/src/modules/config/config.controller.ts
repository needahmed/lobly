import { Controller, Get } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { Public } from "../../common/decorators/public.decorator";
import { FlagsService } from "./flags.service";

@Controller()
export class LcuConfigController {
  constructor(private readonly flags: FlagsService) {}

  @Public()
  @Get("config/lcu-endpoints")
  endpoints() {
    // Resolve from monorepo package (dev) or copied path (prod)
    const candidates = [
      join(__dirname, "../../../../../packages/lcu-endpoints/endpoints.json"),
      join(process.cwd(), "packages/lcu-endpoints/endpoints.json"),
      join(process.cwd(), "../../packages/lcu-endpoints/endpoints.json"),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(readFileSync(p, "utf8"));
      } catch {
        /* try next */
      }
    }
    return {
      version: 1,
      note: "lcu-endpoints package not found on disk",
      endpoints: {},
    };
  }

  @Public()
  @Get("config/flags")
  featureFlags() {
    return this.flags.getFlags();
  }
}
