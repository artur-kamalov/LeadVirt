import {
  BUSINESS_IMPORT_CURRENCY_CODES,
  BUSINESS_SERVICE_MAPPING_TARGETS,
} from "@leadvirt/business-import";
import type {
  BusinessImportApplyPreviewRequest,
  BusinessImportApplyRequest,
  BusinessImportBulkApprovalRequest,
  BusinessImportCandidateDecisionRequest,
  BusinessImportCreateIntentRequest,
  BusinessImportMappingAssignment,
  BusinessImportMappingConfirmRequest,
  BusinessImportMappingDefaults,
  BusinessImportMappingTarget,
  BusinessImportOfferingValue,
} from "@leadvirt/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsDefined,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const MIME_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
] as const;
const IMPORT_STATES = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "SCANNING",
  "PARSING",
  "MAPPING_REQUIRED",
  "EXTRACTING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "APPLYING",
  "PROJECTING",
  "PROJECTION_DELAYED",
  "PARTIALLY_APPLIED",
  "APPLIED",
  "CLOSED_WITH_REMAINDER",
  "FAILED_RETRYABLE",
  "FAILED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
const MAPPING_TARGETS =
  BUSINESS_SERVICE_MAPPING_TARGETS satisfies readonly BusinessImportMappingTarget[];
const MAPPING_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export class BusinessImportCreateIntentDto implements BusinessImportCreateIntentRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  filename!: string;

  @IsIn(MIME_TYPES)
  declaredMimeType!: BusinessImportCreateIntentRequest["declaredMimeType"];

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  byteSize!: number;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(OPAQUE_ID)
  sourceId?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  sourceName?: string | null;
}

export class BusinessImportListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(OPAQUE_ID)
  sourceId?: string;

  @IsOptional()
  @IsIn(IMPORT_STATES)
  state?: (typeof IMPORT_STATES)[number];
}

export class BusinessImportCandidateListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(["ADD", "UPDATE", "LINK", "UNCHANGED", "CONFLICT", "INVALID", "MISSING", "ARCHIVE"])
  action?: string;

  @IsOptional()
  @IsIn(["PENDING", "ACCEPTED", "EDITED", "SUBMITTED_FOR_APPROVAL", "REJECTED", "STALE", "APPLIED"])
  decision?: string;

  @IsOptional()
  @IsIn(["LOW", "MEDIUM", "HIGH", "PROHIBITED"])
  risk?: string;
}

export class BusinessImportPriceDto {
  @IsIn(["FIXED", "FROM", "RANGE", "FREE", "ON_REQUEST"])
  type!: BusinessImportOfferingValue["price"] extends infer Price
    ? Price extends { type: infer Value }
      ? Value
      : never
    : never;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(DECIMAL)
  amount?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(DECIMAL)
  from?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(DECIMAL)
  to?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(80)
  unit?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(500)
  taxNote?: string | null;
}

export class BusinessImportDurationDto {
  @IsInt()
  @Min(1)
  @Max(525_600)
  minimumMinutes!: number;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(525_600)
  maximumMinutes?: number | null;
}

export class BusinessImportOfferingValueDto implements BusinessImportOfferingValue {
  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  externalId?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(160)
  category?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => BusinessImportPriceDto)
  price?: BusinessImportPriceDto | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => BusinessImportDurationDto)
  duration?: BusinessImportDurationDto | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(200)
  locationExternalId?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(1_000)
  bookingNotes?: string | null;

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(DATE)
  validFrom?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(DATE)
  validUntil?: string | null;

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(LANGUAGE)
  language?: string | null;
}

export class BusinessImportCandidateDecisionDto implements BusinessImportCandidateDecisionRequest {
  @IsIn(["ACCEPTED", "REJECTED"])
  decision!: BusinessImportCandidateDecisionRequest["decision"];

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => BusinessImportOfferingValueDto)
  proposed?: BusinessImportOfferingValueDto | null;
}

export class BusinessImportCandidateRefDto {
  @IsString()
  @Matches(OPAQUE_ID)
  id!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  etag!: string;

  @IsIn(["ACCEPTED", "REJECTED"])
  decision!: "ACCEPTED" | "REJECTED";
}

export class BusinessImportBulkDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(400)
  @ArrayUnique((item: BusinessImportCandidateRefDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => BusinessImportCandidateRefDto)
  candidates!: BusinessImportCandidateRefDto[];
}

export class BusinessImportCandidateIdsDto implements BusinessImportApplyPreviewRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  candidateIds!: string[];
}

export class BusinessImportApplyDto
  extends BusinessImportCandidateIdsDto
  implements BusinessImportApplyRequest
{
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  manifestHash!: string;
}

export class BusinessImportApprovalDecisionDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @IsOptional()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

export class BusinessImportBulkApprovalCandidateDto {
  @IsString()
  @Matches(OPAQUE_ID)
  id!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  etag!: string;
}

export class BusinessImportBulkApprovalDto implements BusinessImportBulkApprovalRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((item: BusinessImportBulkApprovalCandidateDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => BusinessImportBulkApprovalCandidateDto)
  candidates!: BusinessImportBulkApprovalCandidateDto[];
}

export class BusinessImportRetryDto {
  @IsInt()
  @Min(1)
  generation!: number;
}

export class BusinessImportMappingAssignmentDto implements BusinessImportMappingAssignment {
  @IsString()
  @Matches(MAPPING_KEY)
  sourceColumnKey!: string;

  @IsIn(MAPPING_TARGETS)
  target!: BusinessImportMappingTarget;
}

export class BusinessImportMappingDefaultsDto implements BusinessImportMappingDefaults {
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @Matches(LANGUAGE)
  locale!: string | null;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsIn(["DECIMAL_DOT", "DECIMAL_COMMA"])
  numberFormat!: BusinessImportMappingDefaults["numberFormat"];

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @IsIn(BUSINESS_IMPORT_CURRENCY_CODES)
  currency!: string | null;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/)
  timezone!: string | null;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  unit!: string | null;
}

export class BusinessImportMappingConfirmDto implements BusinessImportMappingConfirmRequest {
  @IsString()
  @Matches(MAPPING_KEY)
  tableKey!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  schemaHash!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  headerRow!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((item: BusinessImportMappingAssignmentDto) => item.sourceColumnKey)
  @ValidateNested({ each: true })
  @Type(() => BusinessImportMappingAssignmentDto)
  columns!: BusinessImportMappingAssignmentDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => BusinessImportMappingDefaultsDto)
  defaults!: BusinessImportMappingDefaultsDto;
}
