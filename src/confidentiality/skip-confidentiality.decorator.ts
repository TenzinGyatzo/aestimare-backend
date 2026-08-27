import { SetMetadata } from '@nestjs/common';

export const SKIP_CONFIDENTIALITY_KEY = 'skipConfidentiality';

export const SkipConfidentiality = () =>
  SetMetadata(SKIP_CONFIDENTIALITY_KEY, true);
