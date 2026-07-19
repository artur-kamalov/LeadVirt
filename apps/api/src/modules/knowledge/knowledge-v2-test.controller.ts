import {
  Body,
  Controller,
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
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  KnowledgeV2ArchiveTestCaseDto,
  KnowledgeV2CreateTestCaseDto,
  KnowledgeV2TestCaseListQueryDto,
  KnowledgeV2UpdateTestCaseDto,
} from "./dto/knowledge-v2-test.dto.js";
import { requireIdempotencyKey, requireIfMatch } from "./knowledge-v2-http.js";
import { KnowledgeV2TestService } from "./knowledge-v2-test.service.js";
import {
  createKnowledgeV2ValidationPipe,
  knowledgeV2ValidationPipe,
} from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

const testReadRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
const testMutationRoles = ["OWNER", "ADMIN"] as const;
const testCaseListQueryPipe = createKnowledgeV2ValidationPipe(KnowledgeV2TestCaseListQueryDto);

function mutationHeaders(idempotencyKey: HeaderValue, ifMatch: HeaderValue) {
  return {
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    ifMatch: requireIfMatch(ifMatch),
  };
}

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles(...testReadRoles)
@Controller("knowledge/v2/test-cases")
export class KnowledgeV2TestController {
  constructor(
    @Inject(KnowledgeV2TestService)
    private readonly tests: KnowledgeV2TestService,
  ) {}

  @Get()
  async list(
    @CurrentContext() context: RequestContext,
    @Query(testCaseListQueryPipe) query: KnowledgeV2TestCaseListQueryDto,
  ) {
    return { data: await this.tests.listTestCases(context, query) };
  }

  @Get(":testCaseId")
  async detail(
    @CurrentContext() context: RequestContext,
    @Param("testCaseId") testCaseId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.tests.getTestCase(context, testCaseId);
    response.setHeader("ETag", data.etag);
    return { data };
  }

  @Roles(...testMutationRoles)
  @Get(":testCaseId/input")
  async input(
    @CurrentContext() context: RequestContext,
    @Param("testCaseId") testCaseId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    return { data: await this.tests.getTestCaseInput(context, testCaseId) };
  }

  @Roles(...testMutationRoles)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CreateTestCaseDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.tests.createTestCase(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Roles(...testMutationRoles)
  @Patch(":testCaseId")
  async update(
    @CurrentContext() context: RequestContext,
    @Param("testCaseId") testCaseId: string,
    @Body() dto: KnowledgeV2UpdateTestCaseDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.tests.updateTestCase(
      context,
      testCaseId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Roles(...testMutationRoles)
  @Post(":testCaseId/archive")
  async archive(
    @CurrentContext() context: RequestContext,
    @Param("testCaseId") testCaseId: string,
    @Body() dto: KnowledgeV2ArchiveTestCaseDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const headers = mutationHeaders(idempotencyKey, ifMatch);
    const data = await this.tests.archiveTestCase(
      context,
      testCaseId,
      dto,
      headers.idempotencyKey,
      headers.ifMatch,
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }
}
