import { IsOptional, IsString, MaxLength } from "class-validator";

export class ConnectIntegrationDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  botToken?: string;
}
