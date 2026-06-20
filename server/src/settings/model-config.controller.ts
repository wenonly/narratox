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
import { ModelConfigService } from './model-config.service';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';

@Controller('settings/models')
export class ModelConfigController {
  constructor(private readonly configs: ModelConfigService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.configs.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateModelConfigDto) {
    return this.configs.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateModelConfigDto,
  ) {
    return this.configs.update(user.id, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.configs.delete(user.id, id);
  }

  @Post(':id/activate')
  activate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.configs.activate(user.id, id);
  }
}
