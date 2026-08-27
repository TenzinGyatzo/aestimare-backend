import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { clientMetaFromRequest } from '../audit/audit-client-meta';
import {
  ConfidentialityActor,
  ConfidentialityService,
} from './confidentiality.service';
import { SkipConfidentiality } from './skip-confidentiality.decorator';
import { AcceptConfidentialityDto } from './dto/accept-confidentiality.dto';

@ApiTags('confidentiality')
@Controller('confidentiality')
@UseGuards(JwtAuthGuard)
@SkipConfidentiality()
@ApiBearerAuth()
export class ConfidentialityController {
  constructor(
    private readonly confidentialityService: ConfidentialityService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Estado del Acuerdo de Confidencialidad vigente',
  })
  @ApiResponse({ status: 200, description: 'required / accepted / texto si falta' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  getStatus(@CurrentUser() user: ConfidentialityActor) {
    return this.confidentialityService.getStatus(String(user._id ?? ''));
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aceptar la versión vigente del acuerdo (idempotente)',
  })
  @ApiResponse({ status: 200, description: 'Registro de aceptación' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  accept(
    @CurrentUser() user: ConfidentialityActor,
    @Body() dto: AcceptConfidentialityDto = {},
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    const meta = clientMetaFromRequest(req);
    return this.confidentialityService.accept(user, meta.ip, dto?.version);
  }
}
