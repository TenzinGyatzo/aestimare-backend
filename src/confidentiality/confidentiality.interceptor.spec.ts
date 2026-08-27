import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from } from 'rxjs';
import { CONFIDENTIALITY_AGREEMENT_REQUIRED } from './agreement';
import { ConfidentialityAgreementInterceptor } from './confidentiality.interceptor';
import { SKIP_CONFIDENTIALITY_KEY } from './skip-confidentiality.decorator';

describe('ConfidentialityAgreementInterceptor', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const confidentialityService = {
    hasAcceptedCurrent: jest.fn(),
  };
  const interceptor = new ConfidentialityAgreementInterceptor(
    reflector,
    confidentialityService as any,
  );
  const next = { handle: () => from(['ok']) };

  const makeCtx = (
    opts: {
      type?: string;
      user?: { _id?: string } | null;
    } = {},
  ) =>
    ({
      getType: () => opts.type ?? 'http',
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: opts.user }),
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    confidentialityService.hasAcceptedCurrent.mockResolvedValue(false);
  });

  it('deja pasar contexto no HTTP (cron)', async () => {
    const result = await interceptor.intercept(
      makeCtx({ type: 'rpc' }),
      next as any,
    );
    expect(confidentialityService.hasAcceptedCurrent).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('deja pasar request sin usuario (login/health/público)', async () => {
    await interceptor.intercept(makeCtx({ user: null }), next as any);
    expect(confidentialityService.hasAcceptedCurrent).not.toHaveBeenCalled();
  });

  it('respeta @SkipConfidentiality (auth + módulo del acuerdo)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation(
      (key: string) => key === SKIP_CONFIDENTIALITY_KEY,
    );
    await interceptor.intercept(
      makeCtx({ user: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
      next as any,
    );
    expect(confidentialityService.hasAcceptedCurrent).not.toHaveBeenCalled();
  });

  it('403 con code estable si hay usuario sin aceptación vigente', async () => {
    await expect(
      interceptor.intercept(
        makeCtx({ user: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
        next as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    try {
      await interceptor.intercept(
        makeCtx({ user: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
        next as any,
      );
    } catch (err) {
      const response = (err as ForbiddenException).getResponse() as {
        code: string;
        statusCode: number;
      };
      expect(response.code).toBe(CONFIDENTIALITY_AGREEMENT_REQUIRED);
      expect(response.statusCode).toBe(403);
    }
  });

  it('deja pasar si ya aceptó la versión vigente', async () => {
    confidentialityService.hasAcceptedCurrent.mockResolvedValue(true);
    await interceptor.intercept(
      makeCtx({ user: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
      next as any,
    );
    expect(confidentialityService.hasAcceptedCurrent).toHaveBeenCalled();
  });

  it('Mongo caído en el gate → 403 NDA (fail closed)', async () => {
    confidentialityService.hasAcceptedCurrent.mockRejectedValue(
      new Error('mongo down'),
    );
    await expect(
      interceptor.intercept(
        makeCtx({ user: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
        next as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
