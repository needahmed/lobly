import { Controller, Delete } from "@nestjs/common";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Delete("me")
  deleteMe(@CurrentUser() user: JwtPayload) {
    return this.users.deleteMe(user.sub);
  }
}
