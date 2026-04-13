import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    const user = this.config.get('SMTP_USER');
    const pass = this.config.get('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(this.config.get('SMTP_PORT', '587'), 10),
        secure: false,
        auth: { user, pass },
      });
      this.logger.log(`SMTP yapılandırıldı: ${host} (${user})`);
    } else {
      this.logger.warn('SMTP yapılandırılmadı — şifre sıfırlama e-postaları gönderilemez');
    }
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`SMTP yok, e-posta gönderilemiyor: ${to}`);
      return false;
    }

    const from = this.config.get('SMTP_FROM', 'noreply@crm.com');

    try {
      await this.transporter.sendMail({
        from: `"WhatsApp CRM" <${from}>`,
        to,
        subject: 'Şifre Sıfırlama',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
            <h2 style="color:#111827;margin:0 0 8px">Şifre Sıfırlama</h2>
            <p style="color:#6b7280;margin:0 0 24px">Merhaba ${name},</p>
            <p style="color:#374151;margin:0 0 24px">Hesabınız için şifre sıfırlama talebinde bulunuldu. Aşağıdaki bağlantıya tıklayarak yeni şifrenizi belirleyebilirsiniz:</p>
            <a href="${resetUrl}" style="display:inline-block;background:#25D366;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Şifremi Sıfırla</a>
            <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">Bu bağlantı 1 saat geçerlidir. Eğer bu talebi siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz.</p>
          </div>
        `,
      });
      this.logger.log(`Şifre sıfırlama e-postası gönderildi: ${to}`);
      return true;
    } catch (error: any) {
      this.logger.error(`E-posta gönderilemedi (${to}): ${error.message}`);
      return false;
    }
  }
}
