import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // Caddy sits in front in production, so this trusts it for the real
  // visitor's address instead of counting every request as coming from Caddy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // In production the web app and the API share one origin behind Caddy. In
  // local dev they are two ports, so the browser needs this to send the
  // workspace cookie along with the request.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({ origin: 'http://localhost:5173', credentials: true });
  }

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
