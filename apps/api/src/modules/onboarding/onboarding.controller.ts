import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Patch,
  Post,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { knowledgeV2ValidationPipe } from "../knowledge/knowledge-v2-validation.pipe.js";
import {
  AdvanceOnboardingDto,
  CompleteOnboardingStepDto,
  UpdateOnboardingDto,
} from "./dto/update-onboarding.dto.js";
import { OnboardingService } from "./onboarding.service.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Controller("onboarding")
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboardingService: OnboardingService) {}

  @Get("state")
  async state(@CurrentContext() context: RequestContext) {
    const data = await this.onboardingService.state(context);
    return { data };
  }

  @Patch("state")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async update(
    @CurrentContext() context: RequestContext,
    @Body() dto: UpdateOnboardingDto,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const data = await this.onboardingService.update(context, dto, ifMatch);
    return { data };
  }

  @Post("complete-step")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async completeStep(
    @CurrentContext() context: RequestContext,
    @Body() dto: CompleteOnboardingStepDto,
  ) {
    const data = await this.onboardingService.completeStep(context, dto);
    return { data };
  }

  @Post("advance")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async advance(
    @CurrentContext() context: RequestContext,
    @Body() dto: AdvanceOnboardingDto,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const data = await this.onboardingService.advance(context, dto, ifMatch);
    return { data };
  }
}
