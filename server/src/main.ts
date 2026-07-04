import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // bufferLogs:引导期(logger 就绪前)的日志先缓存,就绪后回放 —— 否则 DI/启动错误会丢。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // nestjs-pino's `Logger` is the Nest app logger service (implements LoggerService);
  // `app.useLogger(app.get(Logger))` is the library's documented wiring (not `LoggerService`).
  app.useLogger(app.get(Logger));
  // 开放 CORS:反射任意 Origin + 允许凭证(跨域部署 / 不同端口 都能打;Authorization 头随 preflight 反射)。
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
