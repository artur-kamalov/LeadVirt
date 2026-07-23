import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import type { Response } from "express";
import {
  createBusinessServicesCsvTemplate,
  createBusinessServicesXlsxTemplate,
} from "@leadvirt/business-import";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { requireIdempotencyKey } from "../knowledge/knowledge-v2-http.js";
import { knowledgeV2ValidationPipe } from "../knowledge/knowledge-v2-validation.pipe.js";
import {
  BusinessImportCandidateListQueryDto,
  BusinessImportCandidateDecisionDto,
  BusinessImportBulkDecisionDto,
  BusinessImportCandidateIdsDto,
  BusinessImportApplyDto,
  BusinessImportApprovalDecisionDto,
  BusinessImportBulkApprovalDto,
  BusinessImportCreateIntentDto,
  BusinessImportListQueryDto,
  BusinessImportMappingConfirmDto,
  BusinessImportRetryDto,
  BusinessImportSourceListQueryDto,
} from "./dto/business-import.dto.js";
import { BusinessImportUploadService } from "./business-import-upload.service.js";
import { BusinessImportApplicationService } from "./business-import-application.service.js";
import { BusinessImportRebaseService } from "./business-import-rebase.service.js";
import { BusinessImportMappingService } from "./business-import-mapping.service.js";
import { BusinessImportReviewService } from "./business-import-review.service.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";
import { BusinessImportWorkflowService } from "./business-import-workflow.service.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Controller("business-profile/import-templates")
export class BusinessImportTemplateController {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(BusinessImportRuntimeService)
    private readonly runtime: BusinessImportRuntimeService,
  ) {}

  @Get()
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, max-age=300")
  catalog() {
    const api = this.config.apiUrl.replace(/\/$/u, "");
    const maximum = this.config.businessImportMaxFileBytes;
    let runtimeAvailable = false;
    try {
      this.runtime.runtime();
      runtimeAvailable = true;
    } catch {
      runtimeAvailable = false;
    }
    return {
      data: {
        items: [
          {
            id: "services-csv-v1",
            format: "CSV",
            target: "SERVICES",
            filename: "leadvirt-services-template.csv",
            downloadUrl: `${api}/api/business-profile/imports/templates/services.csv`,
            declaredMimeType: "text/csv",
            maxBytes: maximum,
            enabled: runtimeAvailable,
          },
          {
            id: "services-xlsx-v1",
            format: "XLSX",
            target: "SERVICES",
            filename: "leadvirt-services-template.xlsx",
            downloadUrl: `${api}/api/business-profile/imports/templates/services.xlsx`,
            declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            maxBytes: maximum,
            enabled: runtimeAvailable && this.config.businessImportXlsxSandboxApproved,
          },
          {
            id: "services-pdf-v1",
            format: "PDF",
            target: "SERVICES",
            filename: "",
            downloadUrl: null,
            declaredMimeType: "application/pdf",
            maxBytes: maximum,
            enabled: false,
          },
        ],
      },
    };
  }
}

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Controller("business-profile/imports")
export class BusinessImportController {
  constructor(
    @Inject(BusinessImportUploadService)
    private readonly uploads: BusinessImportUploadService,
    @Inject(BusinessImportViewService)
    private readonly views: BusinessImportViewService,
    @Inject(BusinessImportWorkflowService)
    private readonly workflow: BusinessImportWorkflowService,
    @Inject(BusinessImportReviewService)
    private readonly review: BusinessImportReviewService,
    @Inject(BusinessImportApplicationService)
    private readonly applications: BusinessImportApplicationService,
    @Inject(BusinessImportRebaseService)
    private readonly rebases: BusinessImportRebaseService,
    @Inject(BusinessImportMappingService)
    private readonly mappings: BusinessImportMappingService,
  ) {}

  @Get("templates/services.csv")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  template(@Res() response: Response) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="leadvirt-services-template.csv"',
    );
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(createBusinessServicesCsvTemplate());
  }

  @Get("templates/services.xlsx")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  xlsxTemplate(@Query("locale") locale: string | undefined, @Res() response: Response) {
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="leadvirt-services-template.xlsx"',
    );
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(
      Buffer.from(createBusinessServicesXlsxTemplate({ locale: locale === "ru" ? "ru" : "en" })),
    );
  }

  @Get()
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, no-store")
  async list(
    @CurrentContext() context: RequestContext,
    @Query() query: BusinessImportListQueryDto,
  ) {
    return { data: await this.views.list(context, query) };
  }

  @Get("sources")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, no-store")
  async listSources(
    @CurrentContext() context: RequestContext,
    @Query() query: BusinessImportSourceListQueryDto,
  ) {
    return { data: await this.views.listSources(context, query) };
  }

  @Get(":importId")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  async get(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.views.get(context, importId);
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Get(":importId/mapping")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  async mapping(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.mappings.get(context, importId);
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/mapping/confirm")
  @Roles("OWNER", "ADMIN", "MANAGER")
  @HttpCode(HttpStatus.ACCEPTED)
  async confirmMapping(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportMappingConfirmDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.mappings.confirm(
      context,
      importId,
      dto,
      ifMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Get(":importId/candidates")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, no-store")
  async candidates(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Query() query: BusinessImportCandidateListQueryDto,
  ) {
    return { data: await this.views.listCandidates(context, importId, query) };
  }

  @Patch(":importId/candidates/:candidateId")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async decideCandidate(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Param("candidateId") candidateId: string,
    @Body() dto: BusinessImportCandidateDecisionDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.review.decideCandidate(
      context,
      importId,
      candidateId,
      dto,
      ifMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/decisions/bulk")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async bulkDecide(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportBulkDecisionDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.review.bulkDecide(
        context,
        importId,
        dto,
        ifMatch,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Post(":importId/approval-requests")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async requestApproval(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportCandidateIdsDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.review.requestApproval(
        context,
        importId,
        dto.candidateIds,
        ifMatch,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Post(":importId/apply-preview")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async previewApply(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportCandidateIdsDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("x-business-information-if-match") informationIfMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.applications.preview(
      context,
      importId,
      dto,
      ifMatch,
      informationIfMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/rebase")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async rebase(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.rebases.rebase(
      context,
      importId,
      ifMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/apply")
  @Roles("OWNER", "ADMIN", "MANAGER")
  @HttpCode(HttpStatus.ACCEPTED)
  async apply(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportApplyDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("x-business-information-if-match") informationIfMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.applications.apply(
      context,
      importId,
      dto,
      ifMatch,
      informationIfMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Get(":importId/applications")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, no-store")
  async listApplications(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
  ) {
    return { data: { items: await this.applications.listApplications(context, importId) } };
  }

  @Get(":importId/applications/:applicationId")
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  @Header("Cache-Control", "private, no-store")
  async getApplication(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Param("applicationId") applicationId: string,
  ) {
    return { data: await this.applications.getApplication(context, importId, applicationId) };
  }

  @Post(":importId/approvals/:approvalId/decision")
  @Roles("OWNER", "ADMIN")
  async decideApproval(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Param("approvalId") approvalId: string,
    @Body() dto: BusinessImportApprovalDecisionDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.review.decideApproval(
        context,
        importId,
        approvalId,
        dto,
        ifMatch,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Post(":importId/approvals/bulk")
  @Roles("OWNER", "ADMIN")
  async bulkApprove(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportBulkApprovalDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.review.bulkApprove(
        context,
        importId,
        dto,
        ifMatch,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Post("intents")
  @Roles("OWNER", "ADMIN", "MANAGER")
  @Header("Cache-Control", "private, no-store")
  async createIntent(
    @CurrentContext() context: RequestContext,
    @Body() dto: BusinessImportCreateIntentDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.uploads.createIntent(context, dto, requireIdempotencyKey(idempotencyKey)),
    };
  }

  @Post(":importId/finalize")
  @Roles("OWNER", "ADMIN", "MANAGER")
  @HttpCode(HttpStatus.ACCEPTED)
  async finalize(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.workflow.finalize(
      context,
      importId,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/retry")
  @Roles("OWNER", "ADMIN", "MANAGER")
  @HttpCode(HttpStatus.ACCEPTED)
  async retry(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Body() dto: BusinessImportRetryDto,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.workflow.retry(
      context,
      importId,
      dto,
      ifMatch,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", value.etag);
    response.setHeader("Cache-Control", "private, no-store");
    return { data: value };
  }

  @Post(":importId/cancel")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async cancel(
    @CurrentContext() context: RequestContext,
    @Param("importId") importId: string,
    @Headers("if-match") ifMatch: HeaderValue,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.workflow.cancel(
        context,
        importId,
        ifMatch,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }
}

@Controller("business-profile/imports")
export class BusinessImportUploadController {
  constructor(
    @Inject(BusinessImportUploadService)
    private readonly uploads: BusinessImportUploadService,
  ) {}

  @Put(":importId/content")
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("importId") importId: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Headers("content-length") contentLength: string | undefined,
    @Req() request: Request,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    try {
      return {
        data: await this.uploads.upload(
          importId,
          authorization,
          contentType,
          contentLength,
          request,
          controller.signal,
        ),
      };
    } finally {
      request.removeListener("aborted", abort);
    }
  }
}
