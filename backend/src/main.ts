import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { json as expressJson, urlencoded as expressUrlencoded } from 'express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const frontendUrl = config.get('FRONTEND_URL', 'http://localhost:3000').trim();
  const frontendBase = frontendUrl.replace(/\/$/, '');
  /** Üretimde tarayıcı adresi FRONTEND_URL ile aynı olmalı; sonda / farkı için iki varyant */
  const extraOrigins = (config.get<string>('CORS_EXTRA_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigins =
    process.env.NODE_ENV === 'production'
      ? Array.from(
          new Set([
            frontendUrl,
            frontendBase,
            `${frontendBase}/`,
            ...extraOrigins,
            ...extraOrigins.map((o) => o.replace(/\/$/, '')),
            ...extraOrigins.map((o) => (o.endsWith('/') ? o : `${o}/`)),
          ]),
        )
      : Array.from(
          new Set([
            frontendUrl,
            frontendBase,
            `${frontendBase}/`,
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            ...extraOrigins,
          ]),
        );
  logger.log(`CORS origins (${process.env.NODE_ENV || 'development'}): ${corsOrigins.join(', ')}`);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });
  // WAHA webhook payload'ları (özellikle medya/base64) default body limitini aşabilir.
  app.use('/api/waha/webhook', expressJson({ limit: '50mb' }));
  app.use('/api/waha/webhook', expressUrlencoded({ extended: true, limit: '50mb' }));
  app.use(expressJson({ limit: '5mb' }));
  app.use(expressUrlencoded({ extended: true, limit: '5mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api');

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('WhatsApp CRM API')
      .setDescription('WhatsApp CRM System API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('PORT', 4000);
  await app.listen(port);
  logger.log(`Server running on http://localhost:${port} — build 2026-04-13T21`);
}

bootstrap().catch((err) => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
