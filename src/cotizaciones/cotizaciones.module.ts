import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CotizacionesService } from './cotizaciones.service';
import { CotizacionesController } from './cotizaciones.controller';
import { Cotizacion, CotizacionSchema } from './schemas/cotizacion.schema';
import { Cliente, ClienteSchema } from '../clientes/schemas/cliente.schema';
import {
  RecordatorioRecotizacion,
  RecordatorioRecotizacionSchema,
} from './recordatorios/schemas/recordatorio-recotizacion.schema';
import { RecordatoriosService } from './recordatorios/recordatorios.service';
import { ClientesModule } from '../clientes/clientes.module';
import { ServiciosModule } from '../servicios/servicios.module';
import { EmailService } from './services/email.service';
import { EmailsModule } from '../emails/emails.module';
import { CountersModule } from '../counters/counters.module';
import { PlantillasModule } from '../plantillas/plantillas.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cotizacion.name, schema: CotizacionSchema },
      { name: Cliente.name, schema: ClienteSchema },
      {
        name: RecordatorioRecotizacion.name,
        schema: RecordatorioRecotizacionSchema,
      },
    ]),
    forwardRef(() => ClientesModule),
    ServiciosModule,
    PlantillasModule,
    EmailsModule,
    CountersModule,
    UsersModule,
  ],
  controllers: [CotizacionesController],
  providers: [CotizacionesService, EmailService, RecordatoriosService],
  exports: [CotizacionesService, EmailService, RecordatoriosService],
})
export class CotizacionesModule {}
