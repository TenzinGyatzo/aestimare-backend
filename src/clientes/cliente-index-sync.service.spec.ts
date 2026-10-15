import { ClienteIndexSyncService } from './cliente-index-sync.service';

describe('ClienteIndexSyncService', () => {
  const clienteModel = {
    syncIndexes: jest.fn(),
  };

  const service = new ClienteIndexSyncService(clienteModel as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('onModuleInit llama syncIndexes una vez', async () => {
    clienteModel.syncIndexes.mockResolvedValue([]);

    await service.onModuleInit();

    expect(clienteModel.syncIndexes).toHaveBeenCalledTimes(1);
  });

  it('onModuleInit relanza si syncIndexes rechaza', async () => {
    const error = new Error('sync failed');
    clienteModel.syncIndexes.mockRejectedValue(error);

    await expect(service.onModuleInit()).rejects.toBe(error);
  });
});
