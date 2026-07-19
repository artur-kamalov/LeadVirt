import "reflect-metadata";
import assert from "node:assert/strict";
import type { ArgumentMetadata } from "@nestjs/common";
import {
  KnowledgeV2CreateEvaluationRunDto,
  KnowledgeV2EvaluationRunListQueryDto,
} from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-evaluation-run.dto.js";
import { KnowledgeV2FactListQueryDto } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-fact.dto.js";
import { KnowledgeV2GuidanceListQueryDto } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-guidance.dto.js";
import { KnowledgeV2PublicationListQueryDto } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-publication.dto.js";
import {
  KnowledgeV2ConflictListQueryDto,
  KnowledgeV2ReviewItemListQueryDto,
} from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-review.dto.js";
import {
  KnowledgeV2DocumentListQueryDto,
  KnowledgeV2RevisionListQueryDto,
  KnowledgeV2SourceListQueryDto,
} from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-source.dto.js";
import { KnowledgeV2TestCaseListQueryDto } from "../../apps/api/src/modules/knowledge/dto/knowledge-v2-test.dto.js";
import { createKnowledgeV2ValidationPipe } from "../../apps/api/src/modules/knowledge/knowledge-v2-validation.pipe.js";

async function main() {
  const queryMetadata: ArgumentMetadata = { type: "query" };
  const bodyMetadata: ArgumentMetadata = { type: "body" };

  const listPipe = createKnowledgeV2ValidationPipe(KnowledgeV2EvaluationRunListQueryDto);
  const query = await listPipe.transform(
    { limit: "25", runKind: "PUBLICATION", target: "DRAFT" },
    queryMetadata,
  );
  assert.ok(query instanceof KnowledgeV2EvaluationRunListQueryDto);
  assert.equal(query.limit, 25);
  assert.equal(typeof query.limit, "number");
  assert.equal(query.runKind, "PUBLICATION");
  assert.equal(query.target, "DRAFT");

  for (const QueryDto of [
    KnowledgeV2SourceListQueryDto,
    KnowledgeV2DocumentListQueryDto,
    KnowledgeV2RevisionListQueryDto,
    KnowledgeV2FactListQueryDto,
    KnowledgeV2GuidanceListQueryDto,
    KnowledgeV2PublicationListQueryDto,
    KnowledgeV2ReviewItemListQueryDto,
    KnowledgeV2ConflictListQueryDto,
    KnowledgeV2TestCaseListQueryDto,
  ]) {
    const transformed = await createKnowledgeV2ValidationPipe(QueryDto).transform(
      { limit: "25" },
      queryMetadata,
    );
    assert.ok(transformed instanceof QueryDto);
    assert.equal(transformed.limit, 25);
  }

  await assert.rejects(() => listPipe.transform({ limit: "25x" }, queryMetadata));
  await assert.rejects(() => listPipe.transform({ limit: "0" }, queryMetadata));
  await assert.rejects(() =>
    listPipe.transform({ limit: "25", unknown: "field" }, queryMetadata),
  );

  const createPipe = createKnowledgeV2ValidationPipe(KnowledgeV2CreateEvaluationRunDto);
  const body = await createPipe.transform(
    {
      target: "DRAFT",
      candidateId: "candidate-1",
      candidateVersion: "3",
      candidateManifestHash: "a".repeat(64),
    },
    bodyMetadata,
  );
  assert.ok(body instanceof KnowledgeV2CreateEvaluationRunDto);
  assert.equal(body.candidateVersion, 3);
  assert.equal(typeof body.candidateVersion, "number");

  console.log(JSON.stringify({ checks: 29, passed: 29 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
