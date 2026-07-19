import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  BusinessProfileScheduleDayDto,
  BusinessProfileServiceItemDto,
} from "../../business-profile/dto/business-profile.dto.js";
import { IsKnowledgeV2TimeZone } from "../../knowledge/dto/knowledge-v2-validation.js";

const STEPS = ["business", "channels", "scenario", "company", "crm", "launch"] as const;
const CHANNELS = [
  "instagram",
  "whatsapp",
  "telegram",
  "website",
  "webhook",
  "vk",
  "email",
  "call",
] as const;

export class OnboardingCompanyInfoDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(500)
  avgCheck?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  servicesCatalog?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique((service: BusinessProfileServiceItemDto) => service.id)
  @ValidateNested({ each: true })
  @Type(() => BusinessProfileServiceItemDto)
  services?: BusinessProfileServiceItemDto[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4_000)
  hours?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((entry: BusinessProfileScheduleDayDto) => entry.day)
  @ValidateNested({ each: true })
  @Type(() => BusinessProfileScheduleDayDto)
  weeklySchedule?: BusinessProfileScheduleDayDto[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(10_000)
  availability?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  faq?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  policies?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(20_000)
  escalationRules?: string;
}

export class OnboardingDataDto {
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Matches(/\S/)
  businessType?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(CHANNELS.length)
  @ArrayUnique()
  @IsIn(CHANNELS, { each: true })
  selectedChannels?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(160)
  scenario?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingCompanyInfoDto)
  companyInfo?: OnboardingCompanyInfoDto;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(160)
  crm?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @IsKnowledgeV2TimeZone()
  timezone?: string;
}

export class UpdateOnboardingDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(STEPS)
  currentStep?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingDataDto)
  data?: OnboardingDataDto;
}

export class CompleteOnboardingStepDto {
  @IsIn(STEPS)
  step!: string;
}

export class AdvanceOnboardingDto {
  @IsIn(STEPS)
  step!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingDataDto)
  data?: OnboardingDataDto;
}

function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefined);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, omitUndefined(entry)]),
  );
}

export function normalizeOnboardingUpdate<T extends UpdateOnboardingDto>(dto: T): T {
  return omitUndefined(dto) as T;
}
