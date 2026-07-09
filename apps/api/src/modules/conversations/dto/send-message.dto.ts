import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export class SendMessageAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @IsString()
  @MaxLength(100_000)
  @Matches(/^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/)
  dataUrl!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60 * 1024)
  sizeBytes?: number;
}

export class SendMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => SendMessageAttachmentDto)
  attachments?: SendMessageAttachmentDto[];
}
