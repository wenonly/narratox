import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly kb: KnowledgeService) {}

  /** 全局知识库是所有用户共享的参考资料：JWT 保护（默认全局 guard），但不按 user 隔离。 */
  @Get()
  list(
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ) {
    return this.kb.list({ category, tag, search });
  }

  @Get(':id')
  async entry(@Param('id') id: string) {
    const detail = await this.kb.getEntry(id);
    if (!detail) throw new NotFoundException(`知识条目 ${id} 不存在`);
    return detail;
  }
}
