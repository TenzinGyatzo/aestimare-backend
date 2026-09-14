import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientesService } from './clientes.service';
import { ClientesController } from './clientes.controller';
import { ContactosService } from './contactos.service';
import { ContactosController } from './contactos.controller';
import { Cliente, ClienteSchema } from './schemas/cliente.schema';
import { Contacto, ContactoSchema } from './schemas/contacto.schema';
import {
  Cotizacion,
  CotizacionSchema,
} from '../cotizaciones/schemas/cotizacion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cliente.name, schema: ClienteSchema },
      { name: Contacto.name, schema: ContactoSchema },
      { name: Cotizacion.name, schema: CotizacionSchema },
    ]),
  ],
  controllers: [ClientesController, ContactosController],
  providers: [ClientesService, ContactosService],
  exports: [ClientesService, ContactosService],
})
export class ClientesModule {}
