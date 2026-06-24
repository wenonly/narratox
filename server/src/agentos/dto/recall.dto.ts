import { IsString, IsNotEmpty } from 'class-validator';

/** POST /sessions/:id/recall body — 必须带非空 messageRowId,否则 ValidationPipe 400。
 *  全局 ValidationPipe({ whitelist, forbidNonWhitelisted }) 只校验 DTO 类,inline type 会被绕过,
 *  缺字段会让 Prisma 把 id:undefined 当「无过滤」→ 返回最旧 user 行 → 撤回错轮次。 */
export class RecallDto {
  @IsString()
  @IsNotEmpty()
  messageRowId: string;
}
