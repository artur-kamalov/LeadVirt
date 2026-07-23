import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { BusinessProfileController } from "./business-profile.controller.js";
import { BusinessProfileService } from "./business-profile.service.js";
import {
  BusinessImportController,
  BusinessImportTemplateController,
  BusinessImportUploadController,
} from "./business-import.controller.js";
import { BusinessImportRuntimeService } from "./business-import-runtime.service.js";
import { BusinessImportApplicationService } from "./business-import-application.service.js";
import { BusinessImportMappingService } from "./business-import-mapping.service.js";
import { BusinessImportQueueService } from "./business-import-queue.service.js";
import { BusinessImportRebaseService } from "./business-import-rebase.service.js";
import { BusinessImportReviewService } from "./business-import-review.service.js";
import { BusinessImportUploadService } from "./business-import-upload.service.js";
import { BusinessImportViewService } from "./business-import-view.service.js";
import { BusinessImportWorkflowService } from "./business-import-workflow.service.js";
import { BusinessInformationStateService } from "./business-information-state.service.js";

@Module({
  imports: [ConfigModule, KnowledgeModule],
  controllers: [
    BusinessProfileController,
    BusinessImportTemplateController,
    BusinessImportController,
    BusinessImportUploadController,
  ],
  providers: [
    BusinessProfileService,
    BusinessImportApplicationService,
    BusinessImportMappingService,
    BusinessImportQueueService,
    BusinessImportRebaseService,
    BusinessImportReviewService,
    BusinessImportRuntimeService,
    BusinessImportUploadService,
    BusinessImportViewService,
    BusinessImportWorkflowService,
    BusinessInformationStateService,
    RolesGuard,
  ],
  exports: [BusinessProfileService, BusinessInformationStateService],
})
export class BusinessProfileModule {}
