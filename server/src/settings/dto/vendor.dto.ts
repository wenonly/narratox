import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** 与 FE ModelProvider 保持一致;DB 以字符串存。 */
export const MODEL_PROVIDERS = [
  'deepseek',
  'openai-compatible',
  'anthropic',
  'gemini',
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class CreateVendorDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsIn(MODEL_PROVIDERS)
  provider!: ModelProvider;

  /** 留空走 provider 默认端点。 */
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(MODEL_PROVIDERS)
  provider?: ModelProvider;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  /** 空串 = 不改(见 service.update)。 */
  @IsOptional()
  @IsString()
  apiKey?: string;
}
