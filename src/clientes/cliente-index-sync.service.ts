import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cliente, ClienteDocument } from './schemas/cliente.schema';

@Injectable()
export class ClienteIndexSyncService implements OnModuleInit {
  private readonly logger = new Logger(ClienteIndexSyncService.name);

  constructor(
    @InjectModel(Cliente.name) private clienteModel: Model<ClienteDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const dropped = await this.clienteModel.syncIndexes();
      if (dropped.length > 0) {
        this.logger.log(
          `Índices de clientes eliminados: ${dropped.join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'No se pudieron sincronizar los índices de clientes',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
