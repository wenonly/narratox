import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertAgentOverrideDto {
  @IsString()
  @IsNotEmpty()
  modelConfigId!: string;
}
