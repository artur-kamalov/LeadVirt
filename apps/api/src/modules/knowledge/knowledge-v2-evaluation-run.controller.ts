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
import type { KnowledgeV2CreateEvaluationRunRequest } from "@leadvirt/types";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  KnowledgeV2CreateEvaluationRunDto,
  KnowledgeV2EvaluationRunListQueryDto,
} from "./dto/knowledge-v2-evaluation-run.dto.js";
import { requireIdempotencyKey } from "./knowledge-v2-http.js";
import { KnowledgeV2TestRunService } from "./knowledge-v2-test-run.service.js";
import {
  createKnowledgeV2ValidationPipe,
  knowledgeV2ValidationPipe,
} from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

const createEvaluationRunPipe = createKnowledgeV2ValidationPipe(KnowledgeV2CreateEvaluationRunDto);
const listEvaluationRunsPipe = createKnowledgeV2ValidationPipe(
  KnowledgeV2EvaluationRunListQueryDto,
);

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles("OWNER", "ADMIN", "MANAGER")
@Controller("knowledge/v2/evaluation-runs")
export class KnowledgeV2EvaluationRunController {
  constructor(
    @Inject(KnowledgeV2TestRunService)
    private readonly runs: KnowledgeV2TestRunService,
  ) {}

  @Roles("OWNER", "ADMIN")
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @CurrentContext() context: RequestContext,
    @Body(createEvaluationRunPipe) dto: KnowledgeV2CreateEvaluationRunDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.runs.createEvaluationRun(
      context,
      dto as KnowledgeV2CreateEvaluationRunRequest,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", data.resource.etag);
    response.setHeader("Cache-Control", "no-store, private");
    return { data };
  }

  @Get()
  async list(
    @CurrentContext() context: RequestContext,
    @Query(listEvaluationRunsPipe) query: KnowledgeV2EvaluationRunListQueryDto,
  ) {
    return { data: await this.runs.listEvaluationRuns(context, query) };
  }

  @Get(":runId")
  async detail(
    @CurrentContext() context: RequestContext,
    @Param("runId") runId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.runs.getEvaluationRun(context, runId);
    response.setHeader("ETag", data.etag);
    response.setHeader("Cache-Control", "no-store, private");
    return { data };
  }

  @Roles("OWNER", "ADMIN")
  @Post(":runId/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentContext() context: RequestContext,
    @Param("runId") runId: string,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.runs.cancelEvaluationRun(
      context,
      runId,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }
}
