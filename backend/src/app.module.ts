import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { LeadsModule } from './modules/leads/leads.module';
import { WahaModule } from './modules/waha/waha.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AutoReplyModule } from './modules/auto-reply/auto-reply.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { BillingModule } from './modules/billing/billing.module';
import { SupportModule } from './modules/support/support.module';
import { SystemModule } from './modules/system/system.module';
import { MailModule } from './modules/mail/mail.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { EcommerceModule } from './modules/ecommerce/ecommerce.module';
import { ProductsModule } from './modules/products/products.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { CargoCompaniesModule } from './modules/cargo-companies/cargo-companies.module';
import { KartelasModule } from './modules/kartelas/kartelas.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailModule,
    AuditLogModule,
    AuthModule,
    UsersModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    LeadsModule,
    WahaModule,
    DashboardModule,
    WebsocketModule,
    TasksModule,
    ReportsModule,
    SettingsModule,
    TemplatesModule,
    AutoReplyModule,
    OrganizationsModule,
    BillingModule,
    SupportModule,
    SystemModule,
    IntegrationsModule,
    EcommerceModule,
    PdfModule,
    ProductsModule,
    QuotesModule,
    OrdersModule,
    AccountingModule,
    SuppliersModule,
    CargoCompaniesModule,
    KartelasModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
