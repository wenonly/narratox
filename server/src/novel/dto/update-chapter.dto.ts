import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateChapterDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;
}
