import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateNovelReferenceDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  injectTo?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
