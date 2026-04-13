import { Controller, Post, Body, Logger, Headers, ForbiddenException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { WahaWebhookHandler } from './waha-webhook.handler';

@ApiTags('WAHA Webhook')
@SkipThrottle()
@Controller('waha/webhook')
export class WahaWebhookController {
  private readonly logger = new Logger(WahaWebhookController.name);
  private readonly webhookSecret: string;

  constructor(
    private webhookHandler: WahaWebhookHandler,
    private configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get('WAHA_WEBHOOK_SECRET', '');
  }

  @Post()
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-webhook-secret') secret?: string,
  ) {
    if (this.webhookSecret && secret !== this.webhookSecret) {
      this.logger.warn('Webhook isteği reddedildi: Geçersiz secret');
      throw new ForbiddenException('Geçersiz webhook secret');
    }

    const eventName = payload?.event ?? 'unknown';
    this.logger.debug(`Webhook event: ${eventName}`);

    try {
      switch (eventName) {
        case 'message':
        case 'message.any':
          await this.webhookHandler.handleMessage(payload);
          break;
        case 'message.ack':
          await this.webhookHandler.handleMessageAck(payload);
          break;
        case 'message.reaction':
          await this.webhookHandler.handleReaction(payload);
          break;
        case 'session.status':
          await this.webhookHandler.handleSessionStatus(payload);
          break;
        default:
          this.logger.debug(`Unhandled webhook event: ${eventName}`);
      }
    } catch (error: any) {
      this.logger.error(`Webhook hatası (${eventName}): ${error?.message ?? error}`);
      if (eventName === 'message') {
        throw error;
      }
    }

    return { status: 'ok' };
  }
}
