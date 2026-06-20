import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ChapterService } from './chapter.service';
import { NovelService } from './novel.service';
import { OutlineService } from './outline.service';
import { AcceptDto } from './dto/accept.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Controller('novels')
export class NovelController {
  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly outlines: OutlineService,
  ) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateNovelDto) {
    return this.novels.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.novels.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.novels.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateNovelDto,
  ) {
    return this.novels.update(user.id, id, dto);
  }

  @Delete(':id')
  async delete(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.novels.delete(user.id, id);
    return { ok: true };
  }

  @Get(':id/chapters')
  listChapters(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.chapters.list(user.id, id);
  }

  @Post(':id/chapters')
  createChapter(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.chapters.create(user.id, id, dto);
  }

  /** GET /novels/:id/outline —— 卷 + 章细纲聚合,供右侧大纲面板渲染。 */
  @Get(':id/outline')
  getOutline(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.outlines.listOutline(user.id, id);
  }

  /** 编辑章节正文/标题。 */
  @Patch(':id/chapters/:cid')
  updateChapter(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() dto: UpdateChapterDto,
  ) {
    return this.chapters.update(user.id, id, cid, dto);
  }

  /** 采纳 AI 提案到章节(op: append 接着写 / set 重写本章)。 */
  @Post(':id/accept')
  async accept(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AcceptDto,
  ): Promise<{ ok: true }> {
    await this.novels.accept(user.id, id, dto);
    return { ok: true };
  }

  /** GET /novels/:id/chapters/:order/summary —— 从 DB 重建 MemoryData(供 FE 轮询)。 */
  @Get(':id/chapters/:order/summary')
  getChapterMemory(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('order') order: string,
  ) {
    return this.novels.getChapterMemory(user.id, id, Number(order));
  }
}
