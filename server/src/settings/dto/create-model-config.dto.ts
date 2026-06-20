import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

  /** 仅 openai-compatible 需要(校验);其余 provider 忽略。 */
  @ValidateIf((o: CreateModelConfigDto) => o.provider === 'openai-compatible')
  @IsString()
  @IsNotEmpty()
  @IsOptional()
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
