import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Strip/reject unknown fields on DTOs (RegisterDto/LoginDto). Inline-typed
  // bodies (e.g. the multipart run body) have an Object metatype and are
  // skipped by the pipe, so they are unaffected.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  // Enable shutdown hooks so SIGINT/SIGTERM trigger onModuleDestroy
  // (and therefore PrismaService.$disconnect()).
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
