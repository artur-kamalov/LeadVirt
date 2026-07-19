import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  KnowledgeV2AssignReviewDto,
  KnowledgeV2BulkReviewExecuteDto,
  KnowledgeV2BulkReviewPreviewDto,
  KnowledgeV2ConflictListQueryDto,
  KnowledgeV2DismissReviewDto,
  KnowledgeV2ResolveConflictDto,
  KnowledgeV2ResolveReviewItemDto,
  KnowledgeV2ReviewItemListQueryDto,
} from "./dto/knowledge-v2-review.dto.js";
import { requireIdempotencyKey, requireIfMatch } from "./knowledge-v2-http.js";
import { KnowledgeV2ReviewService } from "./knowledge-v2-review.service.js";
import { KnowledgeV2BulkReviewService } from "./knowledge-v2-bulk-review.service.js";
import {
  createKnowledgeV2ValidationPipe,
  knowledgeV2ValidationPipe,
} from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

const reviewRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
const reviewItemListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2ReviewItemListQueryDto);
const conflictListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2ConflictListQueryDto);

function mutationHeaders(idempotencyKey: HeaderValue, ifMatch: HeaderValue) {
  return {
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    ifMatch: requireIfMatch(ifMatch),
  };
}

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles(...reviewRoles)
@Controller("knowledge/v2")
export class KnowledgeV2ReviewController {
  constructor(
    @Inject(KnowledgeV2ReviewService)
    private readonly reviews: KnowledgeV2ReviewService,
    @Inject(KnowledgeV2BulkReviewService)
    private readonly bulkReviews: KnowledgeV2BulkReviewService,
  ) {}

  @Get("review-items")
  async reviewItems(
    @CurrentContext() context: RequestContext,
    @Query(reviewItemListQueryPipe) query: KnowledgeV2ReviewItemListQueryDto,
  ) {
    return { data: await this.reviews.listReviewItems(context, query) };
  }

  @Roles("OWNER", "ADMIN")
  @Post("review-items/bulk-resolve/preview")
  @HttpCode(HttpStatus.OK)
  async previewBulkResolution(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2BulkReviewPreviewDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return { data: await this.bulkReviews.preview(context, dto) };
  }

  @Roles("OWNER", "ADMIN")
  @Post("review-items/bulk-resolve")
  @HttpCode(HttpStatus.OK)
  async executeBulkResolution(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2BulkReviewExecuteDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return {
      data: await this.bulkReviews.execute(context, dto, requireIdempotencyKey(idempotencyKey)),
    };
  }

  @Get("review-items/:reviewItemId")
  async reviewItem(
    @CurrentContext() context: RequestContext,
    @Param("reviewItemId") reviewItemId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.reviews.getReviewItem(context, reviewItemId);
    response.setHeader("ETag", data.etag);
    return { data };
  }

  @Post("review-items/:reviewItemId/assign")
  @HttpCode(HttpStatus.OK)
  async assignReviewItem(
    @CurrentContext() context: RequestContext,
    @Param("reviewItemId") reviewItemId: string,
    @Body() dto: KnowledgeV2AssignReviewDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.assignReviewItem(
      context,
      reviewItemId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Post("review-items/:reviewItemId/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveReviewItem(
    @CurrentContext() context: RequestContext,
    @Param("reviewItemId") reviewItemId: string,
    @Body() dto: KnowledgeV2ResolveReviewItemDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.resolveReviewItem(
      context,
      reviewItemId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Post("review-items/:reviewItemId/dismiss")
  @HttpCode(HttpStatus.OK)
  async dismissReviewItem(
    @CurrentContext() context: RequestContext,
    @Param("reviewItemId") reviewItemId: string,
    @Body() dto: KnowledgeV2DismissReviewDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.dismissReviewItem(
      context,
      reviewItemId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Get("conflicts")
  async conflicts(
    @CurrentContext() context: RequestContext,
    @Query(conflictListQueryPipe) query: KnowledgeV2ConflictListQueryDto,
  ) {
    return { data: await this.reviews.listConflicts(context, query) };
  }

  @Get("conflicts/:conflictId")
  async conflict(
    @CurrentContext() context: RequestContext,
    @Param("conflictId") conflictId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.reviews.getConflict(context, conflictId);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("ETag", data.etag);
    return { data };
  }

  @Post("conflicts/:conflictId/assign")
  @HttpCode(HttpStatus.OK)
  async assignConflict(
    @CurrentContext() context: RequestContext,
    @Param("conflictId") conflictId: string,
    @Body() dto: KnowledgeV2AssignReviewDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.assignConflict(
      context,
      conflictId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Post("conflicts/:conflictId/resolve")
  @HttpCode(HttpStatus.OK)
  async resolveConflict(
    @CurrentContext() context: RequestContext,
    @Param("conflictId") conflictId: string,
    @Body() dto: KnowledgeV2ResolveConflictDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.resolveConflict(
      context,
      conflictId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Post("conflicts/:conflictId/dismiss")
  @HttpCode(HttpStatus.OK)
  async dismissConflict(
    @CurrentContext() context: RequestContext,
    @Param("conflictId") conflictId: string,
    @Body() dto: KnowledgeV2DismissReviewDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.reviews.dismissConflict(
      context,
      conflictId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }
}
