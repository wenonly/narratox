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
import { MODEL_PROVIDERS, type ModelProvider } from './create-model-config.dto';

export class UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(MODEL_PROVIDERS)
  provider?: ModelProvider;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  /** 三种 provider 都可选地自定义 baseUrl(留空走各自默认端点)。 */
  @IsOptional()
  @IsString()
  baseUrl?: string;

  /** 留空/缺省 = 不改 apiKey(见 service.update)。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  apiKey?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
