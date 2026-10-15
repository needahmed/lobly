import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser, type JwtPayload } from "../../common/decorators/current-user.decorator";
import {
  CreateListingDto,
  ListingStateDto,
  PatchListingDto,
  ReconcilePartyDto,
} from "./dto/listing.dto";
import { ListingsService } from "./listings.service";

@Controller("listings")
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get("mine")
  mine(@CurrentUser() user: JwtPayload) {
    return this.listings.mine(user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateListingDto,
    @Headers("idempotency-key") idem?: string
  ) {
    return this.listings.create(user.sub, body, idem);
  }

  @Patch(":id")
  patch(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: PatchListingDto
  ) {
    return this.listings.patch(user.sub, id, body);
  }

  @Patch(":id/party")
  reconcileParty(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReconcilePartyDto
  ) {
    return this.listings.reconcileParty(user.sub, id, body);
  }

  @Post(":id/state")
  state(
    @CurrentUser() user: JwtPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ListingStateDto
  ) {
    return this.listings.applyState(user.sub, id, body);
  }
}
