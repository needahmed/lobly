import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/decorators/public.decorator";
import { ChampionsService } from "./champions.service";

@Controller()
export class ChampionsController {
  constructor(private readonly champions: ChampionsService) {}

  @Public()
  @Get("static/champions")
  async list() {
    return this.champions.getChampionMap();
  }

  /** Champions + summoner spells + runes + asset URL templates. */
  @Public()
  @Get("static/ddragon")
  async staticData() {
    return this.champions.getStaticData();
  }
}
