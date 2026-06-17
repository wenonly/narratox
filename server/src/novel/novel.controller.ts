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
import { AcceptDto } from './dto/accept.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Controller('novels')
export class NovelController {
  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
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
}
