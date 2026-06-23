import { IsOptional, IsString } from 'class-validator';

export class UpdateNovelReferenceDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  injectTo?: string | null;
}
