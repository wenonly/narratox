import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateModelDto {
  @IsString()
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  /** 可选的友好名(FE 展示)。 */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class UpdateModelDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
