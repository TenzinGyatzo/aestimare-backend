import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ServiciosModule } from './servicios/servicios.module';
import { ClientesModule } from './clientes/clientes.module';
import { CotizacionesModule } from './cotizaciones/cotizaciones.module';
import { MetricsModule } from './metrics/metrics.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { EmailsModule } from './emails/emails.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TenantsModule } from './tenants/tenants.module';
import { PlantillasModule } from './plantillas/plantillas.module';
import { CountersModule } from './counters/counters.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    TenantsModule,
    AuditModule,
    PlantillasModule,
    CountersModule,
    UsersModule,
    AuthModule,
    EmailsModule,
    ServiciosModule,
    ClientesModule,
    CotizacionesModule,
    MetricsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
