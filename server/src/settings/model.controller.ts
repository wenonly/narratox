import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ModelService } from './model.service';
import { CreateModelDto, UpdateModelDto } from './dto/model.dto';

/**
 * Model CRUD + activate。挂在 settings 下,路径与 Vendor 分开:
 *   POST   /settings/vendors/:vid/models
 *   PATCH  /settings/models/:id
 *   DELETE /settings/models/:id
 *   POST   /settings/models/:id/activate
 */
@Controller('settings')
export class ModelController {
  constructor(private readonly models: ModelService) {}

  @Post('vendors/:vid/models')
  create(
    @CurrentUser() user: RequestUser,
    @Param('vid') vid: string,
    @Body() dto: CreateModelDto,
  ) {
    return this.models.create(user.id, vid, dto);
  }

  @Patch('models/:id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateModelDto,
  ) {
    return this.models.update(user.id, id, dto);
  }

  @Delete('models/:id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.delete(user.id, id);
  }

  @Post('models/:id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.models.activate(user.id, id);
  }
}
