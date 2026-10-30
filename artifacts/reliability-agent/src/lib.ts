/**
 * The library entry point — the side-effect-free surface other packages embed.
 *
 * `src/index.ts` is the CLI and calls `main()` on import, so it must never be
 * imported by another module. This file is what `package.json`'s `exports`
 * points at: it re-exports the advisory core (schema, prompt, clients, the
 * assessment function and the caching service) with no top-level side effects.
 *
 * The api-server depends on this to serve the advisory endpoint, so the model
 * call, the prompt, the JSON schema and the cache live in one place and cannot
 * drift between the CLI and the HTTP surface.
 */

export {
  ADVISORY_DISCLAIMER,
  AdvisoryService,
  createAdvisoryServiceFromEnv,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_CONCURRENCY,
  isEvidenceInconclusive,
  type AdvisorEnvHandle,
  type AdvisoryOutcome,
  type AdvisoryServiceDeps,
  type AdvisorySuccess,
  type AdvisoryUnavailable,
} from "./advisory";

export { assessProvider, type AssessOptions, type AssessResult } from "./assess";

export { ConfigError, isMockEnabled, loadConfig, type AdvisorConfig } from "./config";

export type { ModelRequestPayload, ReliabilityEvidence } from "./evidence";

export { EvidenceClient, EvidenceError, type EvidenceClientDeps } from "./evidenceClient";

export { createLogger, silentLogger, type Logger, type LogLevel } from "./logger";

export { HttpMetaClient, MetaApiError, extractAssistantContent, type ModelClient } from "./metaClient";

export {
  FIXTURES,
  FixtureMetaClient,
  assessFromFixture,
  chooseFixtureName,
  parseEvidenceFromPayload,
} from "./mockClient";

export {
  buildModelRequest,
  buildRecommendationRequest,
  RECOMMENDATION_FIXTURE_NAME,
  RECOMMENDATION_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "./prompt";

export {
  AI_EXPLANATION_UNAVAILABLE_NOTE,
  DEFAULT_RECOMMENDATION_CACHE_TTL_MS,
  DEFAULT_RECOMMENDATION_MAX_CONCURRENCY,
  deterministicRecommendation,
  NOT_ENOUGH_EVIDENCE_LABEL,
  RECOMMENDATION_DISCLAIMER,
  RecommendationService,
  recommendationCacheKey,
  createRecommendationServiceFromEnv,
  type RecommendationEnvHandle,
  type RecommendationOutcome,
  type RecommendationServiceDeps,
  type RecommendationSuccess,
  type RecommendationUnavailable,
  type RecommendedCandidate,
} from "./recommendation";

export {
  availableCapacityGb,
  DEFAULT_RECOMMENDATION_LIMIT,
  DEFAULT_REFERENCE_PRICE_PER_GB_PER_EPOCH,
  humanizeAge,
  passesHardFilters,
  rankCandidates,
  SCORE_WEIGHTS,
  type CandidateFacts,
  type RankedCandidate,
  type RankingOptions,
  type RankingResult,
  type RecommendationCandidateInput,
  type RecommendationQuery,
} from "./ranking";

export {
  ASSESSMENT_JSON_SCHEMA,
  candidateExplanationSchema,
  RECOMMENDATION_JSON_SCHEMA,
  recommendationExplanationSchema,
  RISK_LEVELS,
  assessmentSchema,
  unknownAssessment,
  type Assessment,
  type CandidateExplanation,
  type RecommendationExplanation,
  type RiskLevel,
} from "./schema";
