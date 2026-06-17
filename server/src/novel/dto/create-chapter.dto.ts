import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChapterDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
