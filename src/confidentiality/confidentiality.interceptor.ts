import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { CONFIDENTIALITY_AGREEMENT_REQUIRED } from './agreement';
import { ConfidentialityService } from './confidentiality.service';
import { SKIP_CONFIDENTIALITY_KEY } from './skip-confidentiality.decorator';

@Injectable()
export class ConfidentialityAgreementInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly confidentialityService: ConfidentialityService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_CONFIDENTIALITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<{
      user?: { _id?: string };
    }>();
    const userId = req.user?._id ? String(req.user._id) : '';
    if (!userId) {
      return next.handle();
    }

    const accepted = await this.confidentialityService
      .hasAcceptedCurrent(userId)
      .catch(() => {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Debe aceptar el acuerdo de confidencialidad',
          code: CONFIDENTIALITY_AGREEMENT_REQUIRED,
        });
      });
    if (!accepted) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Debe aceptar el acuerdo de confidencialidad',
        code: CONFIDENTIALITY_AGREEMENT_REQUIRED,
      });
    }

    return next.handle();
  }
}
