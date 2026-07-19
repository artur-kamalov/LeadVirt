import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import type { KnowledgeV2CapabilityType } from "@leadvirt/types";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  KnowledgeV2CreateFactDto,
  KnowledgeV2FactDecisionDto,
  KnowledgeV2FactListQueryDto,
  KnowledgeV2UpdateFactDto,
} from "./dto/knowledge-v2-fact.dto.js";
import {
  KnowledgeV2CreateGuidanceRuleDto,
  KnowledgeV2GuidanceDecisionDto,
  KnowledgeV2GuidanceListQueryDto,
  KnowledgeV2UpdateGuidanceRuleDto,
} from "./dto/knowledge-v2-guidance.dto.js";
import {
  KnowledgeV2CreatePublicationDto,
  KnowledgeV2PublicationListQueryDto,
  KnowledgeV2RollbackPublicationDto,
  KnowledgeV2ValidatePublicationDto,
} from "./dto/knowledge-v2-publication.dto.js";
import { KnowledgeV2UpdateSettingsDto } from "./dto/knowledge-v2-settings.dto.js";
import { KnowledgeV2UpdateCapabilityDto } from "./dto/knowledge-v2-capability.dto.js";
import {
  KnowledgeV2CreateSourceDto,
  KnowledgeV2CreateFileUploadIntentDto,
  KnowledgeV2DeleteSourceDto,
  KnowledgeV2DocumentListQueryDto,
  KnowledgeV2ExcludeRevisionDto,
  KnowledgeV2RevisionListQueryDto,
  KnowledgeV2SourceActionDto,
  KnowledgeV2SourceListQueryDto,
  KnowledgeV2UpdateSourceDto,
} from "./dto/knowledge-v2-source.dto.js";
import { requireIdempotencyKey, requireIfMatch } from "./knowledge-v2-http.js";
import { KnowledgeV2PublicationService } from "./knowledge-v2-publication.service.js";
import { KnowledgeV2CapabilityService } from "./knowledge-v2-capability.service.js";
import {
  createKnowledgeV2ValidationPipe,
  knowledgeV2ValidationPipe,
} from "./knowledge-v2-validation.pipe.js";
import { KnowledgeV2Service } from "./knowledge-v2.service.js";
import { KnowledgeV2SourceService } from "./knowledge-v2-source.service.js";
import { KnowledgeV2FileUploadService } from "./knowledge-v2-file-upload.service.js";

type HeaderValue = string | string[] | undefined;

const contentRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
const publisherRoles = ["OWNER", "ADMIN"] as const;
const sourceMutationRoles = ["OWNER", "ADMIN"] as const;
const sourceReadRoles = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;
const sourcePreviewRoles = ["OWNER", "ADMIN", "MANAGER", "AGENT"] as const;
const sourceListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2SourceListQueryDto);
const documentListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2DocumentListQueryDto);
const revisionListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2RevisionListQueryDto);
const factListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2FactListQueryDto);
const guidanceListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2GuidanceListQueryDto);
const publicationListQueryPipe = createKnowledgeV2ValidationPipe(
  KnowledgeV2PublicationListQueryDto,
);

function setEtag(response: Response, etag: string) {
  response.setHeader("ETag", etag);
}

function mutationHeaders(idempotencyKey: HeaderValue, ifMatch: HeaderValue) {
  return {
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    ifMatch: requireIfMatch(ifMatch),
  };
}

const capabilityTypes = new Set<KnowledgeV2CapabilityType>([
  "GENERAL_FAQ",
  "LEAD_QUALIFICATION",
  "PRICING",
  "APPOINTMENT_DISCOVERY",
  "APPOINTMENT_BOOKING",
  "ORDER_ACCOUNT_SUPPORT",
  "COMMERCE_RECOMMENDATION",
  "REGULATED_TOPIC",
]);

function capabilityType(value: string): KnowledgeV2CapabilityType {
  if (!capabilityTypes.has(value as KnowledgeV2CapabilityType)) {
    throw new BadRequestException("Capability type is invalid.");
  }
  return value as KnowledgeV2CapabilityType;
}

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles(...contentRoles)
@Controller("knowledge/v2")
export class KnowledgeV2Controller {
  constructor(
    @Inject(KnowledgeV2Service) private readonly knowledge: KnowledgeV2Service,
    @Inject(KnowledgeV2CapabilityService)
    private readonly capabilities: KnowledgeV2CapabilityService,
    @Inject(KnowledgeV2PublicationService)
    private readonly publications: KnowledgeV2PublicationService,
    @Inject(KnowledgeV2SourceService)
    private readonly sources: KnowledgeV2SourceService,
    @Inject(KnowledgeV2FileUploadService)
    private readonly fileUploads: KnowledgeV2FileUploadService,
  ) {}

  @Get("overview")
  async overview(@CurrentContext() context: RequestContext) {
    return { data: await this.publications.getOverview(context) };
  }

  @Get("readiness")
  async readiness(@CurrentContext() context: RequestContext) {
    return { data: await this.publications.getReadiness(context) };
  }

  @Roles(...sourceReadRoles)
  @Get("sources")
  async sourceList(
    @CurrentContext() context: RequestContext,
    @Query(sourceListQueryPipe) query: KnowledgeV2SourceListQueryDto,
  ) {
    return { data: await this.sources.listSources(context, query) };
  }

  @Roles(...sourceMutationRoles)
  @Post("sources")
  @HttpCode(HttpStatus.ACCEPTED)
  async createSource(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateSourceDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.sources.createSource(context, dto, requireIdempotencyKey(idempotencyKey)),
    };
  }

  @Roles(...sourceMutationRoles)
  @Post("file-uploads/intents")
  @HttpCode(HttpStatus.CREATED)
  async createFileUploadIntent(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateFileUploadIntentDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    return {
      data: await this.fileUploads.createIntent(
        context,
        dto,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Roles(...sourceMutationRoles)
  @Post("file-uploads/:intentId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  async completeFileUpload(
    @CurrentContext() context: RequestContext,
    @Param("intentId") intentId: string,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.fileUploads.complete(
        context,
        intentId,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Roles(...sourceReadRoles)
  @Get("sources/:sourceId")
  async source(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.sources.getSource(context, sourceId);
    setEtag(response, data.etag);
    return { data };
  }

  @Roles(...sourceMutationRoles)
  @Patch("sources/:sourceId")
  async updateSource(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Body() dto: KnowledgeV2UpdateSourceDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.sources.updateSource(
      context,
      sourceId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    response.status(data.job ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return { data };
  }

  @Roles(...sourceMutationRoles)
  @Post("sources/:sourceId/sync")
  @HttpCode(HttpStatus.ACCEPTED)
  async syncSource(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Body() dto: KnowledgeV2SourceActionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    return {
      data: await this.sources.syncSource(
        context,
        sourceId,
        dto,
        headers.idempotencyKey,
        headers.ifMatch,
      ),
    };
  }

  @Roles(...sourceMutationRoles)
  @Post("sources/:sourceId/pause")
  @HttpCode(HttpStatus.OK)
  async pauseSource(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Body() dto: KnowledgeV2SourceActionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.sources.pauseSource(
      context,
      sourceId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...sourceMutationRoles)
  @Post("sources/:sourceId/resume")
  @HttpCode(HttpStatus.ACCEPTED)
  async resumeSource(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Body() dto: KnowledgeV2SourceActionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    return {
      data: await this.sources.resumeSource(
        context,
        sourceId,
        dto,
        headers.idempotencyKey,
        headers.ifMatch,
      ),
    };
  }

  @Roles(...sourceMutationRoles)
  @Delete("sources/:sourceId")
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteSource(
    @CurrentContext() context: RequestContext,
    @Param("sourceId") sourceId: string,
    @Body() dto: KnowledgeV2DeleteSourceDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    return {
      data: await this.sources.deleteSource(
        context,
        sourceId,
        dto,
        headers.idempotencyKey,
        headers.ifMatch,
      ),
    };
  }

  @Roles(...sourceReadRoles)
  @Get("documents")
  async documents(
    @CurrentContext() context: RequestContext,
    @Query(documentListQueryPipe) query: KnowledgeV2DocumentListQueryDto,
  ) {
    return { data: await this.sources.listDocuments(context, query) };
  }

  @Roles(...sourceReadRoles)
  @Get("documents/:documentId")
  async document(
    @CurrentContext() context: RequestContext,
    @Param("documentId") documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.sources.getDocument(context, documentId);
    setEtag(response, data.etag);
    return { data };
  }

  @Roles(...sourceReadRoles)
  @Get("documents/:documentId/revisions")
  async documentRevisions(
    @CurrentContext() context: RequestContext,
    @Param("documentId") documentId: string,
    @Query(revisionListQueryPipe) query: KnowledgeV2RevisionListQueryDto,
  ) {
    return { data: await this.sources.listDocumentRevisions(context, documentId, query) };
  }

  @Roles(...sourcePreviewRoles)
  @Get("revisions/:revisionId/preview")
  async revisionPreview(
    @CurrentContext() context: RequestContext,
    @Param("revisionId") revisionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.sources.previewRevision(context, revisionId);
    setEtag(response, data.revision.etag);
    return { data };
  }

  @Roles(...sourceMutationRoles)
  @Post("revisions/:revisionId/exclude")
  @HttpCode(HttpStatus.ACCEPTED)
  async excludeRevision(
    @CurrentContext() context: RequestContext,
    @Param("revisionId") revisionId: string,
    @Body() dto: KnowledgeV2ExcludeRevisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    return {
      data: await this.sources.excludeRevision(
        context,
        revisionId,
        dto,
        headers.idempotencyKey,
        headers.ifMatch,
      ),
    };
  }

  @Get("settings")
  async settings(
    @CurrentContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.knowledge.getSettings(context);
    setEtag(response, data.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Patch("settings")
  async updateSettings(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2UpdateSettingsDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.updateSettings(
      context,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Get("capabilities")
  async capabilityList(@CurrentContext() context: RequestContext) {
    return { data: await this.capabilities.listCapabilities(context) };
  }

  @Roles(...publisherRoles)
  @Patch("capabilities/:capabilityType")
  async updateCapability(
    @CurrentContext() context: RequestContext,
    @Param("capabilityType") capabilityTypeValue: string,
    @Body() dto: KnowledgeV2UpdateCapabilityDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.capabilities.updateCapability(
      context,
      capabilityType(capabilityTypeValue),
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Get("facts")
  async facts(
    @CurrentContext() context: RequestContext,
    @Query(factListQueryPipe) query: KnowledgeV2FactListQueryDto,
  ) {
    return { data: await this.knowledge.listFacts(context, query) };
  }

  @Roles(...contentRoles)
  @Post("facts")
  @HttpCode(HttpStatus.CREATED)
  async createFact(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateFactDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.knowledge.createFact(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Patch("facts/:factId")
  async updateFact(
    @CurrentContext() context: RequestContext,
    @Param("factId") factId: string,
    @Body() dto: KnowledgeV2UpdateFactDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.updateFact(
      context,
      factId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Post("facts/:factId/verify")
  @HttpCode(HttpStatus.OK)
  async verifyFact(
    @CurrentContext() context: RequestContext,
    @Param("factId") factId: string,
    @Body() dto: KnowledgeV2FactDecisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.verifyFact(
      context,
      factId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Post("facts/:factId/reject")
  @HttpCode(HttpStatus.OK)
  async rejectFact(
    @CurrentContext() context: RequestContext,
    @Param("factId") factId: string,
    @Body() dto: KnowledgeV2FactDecisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.rejectFact(
      context,
      factId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Get("guidance")
  async guidance(
    @CurrentContext() context: RequestContext,
    @Query(guidanceListQueryPipe) query: KnowledgeV2GuidanceListQueryDto,
  ) {
    return { data: await this.knowledge.listGuidance(context, query) };
  }

  @Roles(...contentRoles)
  @Post("guidance")
  @HttpCode(HttpStatus.CREATED)
  async createGuidanceRule(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateGuidanceRuleDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.knowledge.createGuidanceRule(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Patch("guidance/:ruleId")
  async updateGuidanceRule(
    @CurrentContext() context: RequestContext,
    @Param("ruleId") ruleId: string,
    @Body() dto: KnowledgeV2UpdateGuidanceRuleDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.updateGuidanceRule(
      context,
      ruleId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Post("guidance/:ruleId/approve")
  @HttpCode(HttpStatus.OK)
  async approveGuidanceRule(
    @CurrentContext() context: RequestContext,
    @Param("ruleId") ruleId: string,
    @Body() dto: KnowledgeV2GuidanceDecisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.approveGuidanceRule(
      context,
      ruleId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Post("guidance/:ruleId/reject")
  @HttpCode(HttpStatus.OK)
  async rejectGuidanceRule(
    @CurrentContext() context: RequestContext,
    @Param("ruleId") ruleId: string,
    @Body() dto: KnowledgeV2GuidanceDecisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.rejectGuidanceRule(
      context,
      ruleId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...contentRoles)
  @Post("guidance/:ruleId/disable")
  @HttpCode(HttpStatus.OK)
  async disableGuidanceRule(
    @CurrentContext() context: RequestContext,
    @Param("ruleId") ruleId: string,
    @Body() dto: KnowledgeV2GuidanceDecisionDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.knowledge.disableGuidanceRule(
      context,
      ruleId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Get("publications/active")
  async activePublication(
    @CurrentContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { publication, etag } = await this.publications.getActivePublicationWithEtag(context);
    setEtag(response, etag);
    return { data: publication };
  }

  @Get("publications")
  async publicationHistory(
    @CurrentContext() context: RequestContext,
    @Query(publicationListQueryPipe) query: KnowledgeV2PublicationListQueryDto,
  ) {
    return { data: await this.publications.listPublications(context, query) };
  }

  @Get("publications/:publicationId")
  async publication(
    @CurrentContext() context: RequestContext,
    @Param("publicationId") publicationId: string,
  ) {
    return { data: await this.publications.getPublication(context, publicationId) };
  }

  @Roles(...contentRoles)
  @Post("publications/validate")
  @HttpCode(HttpStatus.CREATED)
  async validatePublication(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2ValidatePublicationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.publications.validatePublication(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
    setEtag(response, data.resource.etag);
    return { data };
  }

  @Roles(...publisherRoles)
  @Post("publications")
  @HttpCode(HttpStatus.ACCEPTED)
  async createPublication(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreatePublicationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.publications.publishPublication(
        context,
        dto,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Roles(...publisherRoles)
  @Post("publications/:publicationId/rollback")
  @HttpCode(HttpStatus.ACCEPTED)
  async rollbackPublication(
    @CurrentContext() context: RequestContext,
    @Param("publicationId") publicationId: string,
    @Body() dto: KnowledgeV2RollbackPublicationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    return {
      data: await this.publications.rollbackPublication(
        context,
        publicationId,
        dto,
        headers.idempotencyKey,
        headers.ifMatch,
      ),
    };
  }

  @Get("jobs/:jobId")
  async job(@CurrentContext() context: RequestContext, @Param("jobId") jobId: string) {
    return { data: await this.publications.getJob(context, jobId) };
  }
}
