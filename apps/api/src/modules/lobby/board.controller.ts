import { Controller, Get, Query } from "@nestjs/common";
import type { BoardSort } from "@lobly/shared-types";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { BoardService } from "./board.service";

@Controller("board")
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  browse(
    @CurrentUser() user: JwtPayload,
    @Query("queueId") queueId?: string,
    @Query("roles") roles?: string,
    @Query("minRank") minRank?: string,
    @Query("maxRank") maxRank?: string,
    @Query("voice") voice?: string,
    @Query("language") language?: string,
    @Query("sort") sort?: BoardSort,
    @Query("riotAccountId") riotAccountId?: string
  ) {
    return this.board.browse(user.sub, {
      queueId: queueId ? Number(queueId) : undefined,
      roles,
      minRank,
      maxRank,
      voice,
      language,
      sort,
      riotAccountId,
    });
  }
}
