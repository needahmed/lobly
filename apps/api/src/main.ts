import "./env";

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, RequestMethod, Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("Bootstrap");

  // C8: Overwolf origins are overwolf-extension://<uid> — reflect request origin
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix("v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "config/(.*)", method: RequestMethod.ALL },
      { path: "static/(.*)", method: RequestMethod.ALL },
    ],
  });

  const port = Number(process.env.PORT ?? 8790);
  await app.listen(port);
  logger.log(`LOBLY API listening on :${port}`);
}

bootstrap();
