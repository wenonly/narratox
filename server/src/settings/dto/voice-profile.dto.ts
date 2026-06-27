import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateVoiceProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(8000)
  profile!: string;
}

export class UpdateVoiceProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsString()
  @MaxLength(8000)
  profile?: string;
}

export class GenerateVoiceProfileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  samples!: string[];
}
