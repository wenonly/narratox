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
import { VendorService } from './vendor.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

@Controller('settings/vendors')
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.vendors.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVendorDto) {
    return this.vendors.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendors.update(user.id, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.vendors.delete(user.id, id);
  }
}
