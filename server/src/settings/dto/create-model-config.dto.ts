import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 与 ModelProvider (FE) 保持一致;DB 以字符串存。 */
export const MODEL_PROVIDERS = [
  'openai-compatible',
  'anthropic',
  'gemini',
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export class CreateModelConfigDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsIn(MODEL_PROVIDERS)
  provider!: ModelProvider;

  @IsString()
  @MaxLength(120)
  model!: string;

  /** 三种 provider 都可选地自定义 baseUrl(留空走各自默认端点)。 */
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsString()
  @IsNotEmpty()
  apiKey!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
