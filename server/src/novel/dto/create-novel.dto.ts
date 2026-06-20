import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNovelDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  synopsis?: string;

  /** 写作设定: { style?, language?, worldviewText?, coreConflict?, chapterWordTarget? } */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
