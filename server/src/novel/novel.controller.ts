import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ChapterService } from './chapter.service';
import { NovelService } from './novel.service';
import { OutlineService } from './outline.service';
import { WorldEntryService } from './world-entry.service';
import { CharacterService } from './character.service';
import { NovelReferenceService } from './novel-reference.service';
import { StoryEventService } from '../memory/story-event.service';
import { EventService } from '../memory/event.service';
import { StatusService } from './status.service';
import { formatForPublish } from './publish';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { UpdateNovelReferenceDto } from './dto/update-novel-reference.dto';
import { CreateNovelReferenceDto } from './dto/create-novel-reference.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Controller('novels')
export class NovelController {
  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly outlines: OutlineService,
    private readonly world: WorldEntryService,
    private readonly characters: CharacterService,
    private readonly references: NovelReferenceService,
    private readonly hooks: StoryEventService,
    private readonly events: EventService,
    private readonly status: StatusService,
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

  @Get(':id/publish')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('title') title?: string,
    @Query('synopsis') synopsis?: string,
    @Query('indent') indent?: string,
  ): Promise<string> {
    const novel = await this.novels.get(user.id, id);
    const chs = await this.chapters.list(user.id, id);
    return formatForPublish(
      { title: novel.title, synopsis: novel.synopsis },
      chs.map((c) => ({
        order: c.order,
        title: c.title ?? '',
        content: c.content ?? '',
      })),
      {
        from: Number(from) || 0,
        to: Number(to) || 0,
        includeTitle: title !== '0',
        includeSynopsis: synopsis === '1',
        indent: indent !== '0',
      },
    );
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

  /** GET /novels/:id/worldview —— 世界观条目列表,供右侧世界观面板渲染。 */
  @Get(':id/worldview')
  getWorldview(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.world.listEntries(user.id, id);
  }

  /** GET /novels/:id/hooks —— 伏笔账本(含 stale/依赖),供右侧状态面板渲染。 */
  @Get(':id/hooks')
  getHooks(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.hooks.listForStatusView(user.id, id);
  }

  /** GET /novels/:id/events —— 故事事件账本(按章),供右侧事件时间线面板渲染。 */
  @Get(':id/events')
  getEvents(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.events.listForPanel(user.id, id);
  }

  /** GET /novels/:id/status —— 小说态势(进度/立项/覆盖/健康/下一步),供右侧态势面板。 */
  @Get(':id/status')
  getStatus(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.status.getOverview(user.id, id);
  }

  /** GET /novels/:id/references —— 小说级参考资料列表,供右侧参考资料面板渲染。 */
  @Get(':id/references')
  getReferences(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.references.listAll(user.id, id);
  }

  /** PATCH /novels/:id/references/:rid —— 编辑一条参考资料(改 content/injectTo 等)。 */
  @Patch(':id/references/:rid')
  updateReference(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Body() dto: UpdateNovelReferenceDto,
  ) {
    return this.references.update(user.id, id, rid, dto);
  }

  /** POST /novels/:id/references —— 新增单条参考资料。 */
  @Post(':id/references')
  createReference(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateNovelReferenceDto,
  ) {
    return this.references.create(user.id, id, dto);
  }

  /** DELETE /novels/:id/references/:rid —— 删单条参考资料。 */
  @Delete(':id/references/:rid')
  deleteReference(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('rid') rid: string,
  ) {
    return this.references.deleteOne(user.id, id, rid);
  }

  /** GET /novels/:id/characters —— 角色列表(含当前态+时间线),供右侧角色面板。 */
  @Get(':id/characters')
  getCharacters(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.characters.listCharacters(user.id, id);
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

  /** GET /novels/:id/chapters/:order/summary —— 从 DB 重建 MemoryData(供 FE 轮询)。 */
  @Get(':id/chapters/:order/summary')
  getChapterMemory(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('order') order: string,
  ) {
    return this.novels.getChapterMemory(user.id, id, Number(order));
  }

  /** PUT /novels/:id/voice-profile —— 设/清当前小说的作者画像。 */
  @Put(':id/voice-profile')
  async setVoiceProfile(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { voiceProfileId: string | null },
  ): Promise<{ ok: true }> {
    await this.novels.setVoiceProfile(user.id, id, body.voiceProfileId);
    return { ok: true };
  }
}
