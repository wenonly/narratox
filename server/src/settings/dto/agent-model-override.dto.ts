import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertAgentOverrideDto {
  /** 指向 Model 表;空(或不传)= 清除该 agent 的 override。 */
  @IsOptional()
  @IsString()
  modelId?: string;

  /** per-agent 温度覆盖;null = 回退到 Model 自带 temperature。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number | null;
}
