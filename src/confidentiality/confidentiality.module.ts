import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfidentialityAgreementInterceptor } from './confidentiality.interceptor';
import { ConfidentialityController } from './confidentiality.controller';
import { ConfidentialityService } from './confidentiality.service';
import {
  ConfidentialityAcceptance,
  ConfidentialityAcceptanceSchema,
} from './schemas/confidentiality-acceptance.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ConfidentialityAcceptance.name,
        schema: ConfidentialityAcceptanceSchema,
      },
    ]),
  ],
  controllers: [ConfidentialityController],
  providers: [
    ConfidentialityService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ConfidentialityAgreementInterceptor,
    },
  ],
  exports: [ConfidentialityService],
})
export class ConfidentialityModule {}
