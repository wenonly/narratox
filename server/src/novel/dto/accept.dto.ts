import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class AcceptDto {
  @IsString()
  @IsNotEmpty()
  chapterId!: string;

  /** 'append' = 接着写(追加到本章末尾);'set' = 重写本章 */
  @IsIn(['set', 'append'])
  op!: 'set' | 'append';

  @IsString()
  @IsNotEmpty()
  content!: string;
}
