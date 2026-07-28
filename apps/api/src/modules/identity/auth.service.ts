import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { createHash, randomUUID } from "crypto";
import type Redis from "ioredis";
import { User } from "../../database/entities";
import { REDIS_CLIENT } from "../../common/redis/redis.constants";
import type { AuthTokens, AuthUser } from "@lobly/shared-types";

const ACCESS_TTL = "15m";
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const BCRYPT_COST = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  async register(email: string, password: string): Promise<AuthTokens> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email: normalized } });
    if (existing) throw new ConflictException({ code: "EMAIL_TAKEN", message: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await this.users.save(
      this.users.create({ email: normalized, passwordHash })
    );
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const normalized = email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user) throw new UnauthorizedException({ code: "INVALID_CREDENTIALS" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ code: "INVALID_CREDENTIALS" });
    if (user.banned) throw new UnauthorizedException({ code: "ACCOUNT_BANNED" });

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (await this.isDenied(refreshToken)) {
      throw new UnauthorizedException({ code: "TOKEN_REVOKED" });
    }

    let payload: { sub: string; jti?: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException({ code: "INVALID_REFRESH" });
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException({ code: "INVALID_REFRESH" });

    // Rotate: denylist old refresh, issue new pair
    await this.denylist(refreshToken, REFRESH_TTL_SEC);
    const tokens = await this.issueTokens(user);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    if (refreshToken) {
      await this.denylist(refreshToken, REFRESH_TTL_SEC);
    }
    return { ok: true };
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id },
      {
        secret: this.config.getOrThrow<string>("JWT_SECRET"),
        expiresIn: ACCESS_TTL,
      }
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() },
      {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: REFRESH_TTL_SEC,
      }
    );

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUser(user),
    };
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private denylistKey(token: string): string {
    return `auth:deny:${createHash("sha256").update(token).digest("hex")}`;
  }

  private async denylist(token: string, ttlSec: number): Promise<void> {
    await this.redis.set(this.denylistKey(token), "1", "EX", ttlSec);
  }

  private async isDenied(token: string): Promise<boolean> {
    const v = await this.redis.get(this.denylistKey(token));
    return v != null;
  }
}
