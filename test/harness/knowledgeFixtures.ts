// Fixture builder for `PublicKnowledgeSettings`. The tunable fields come from
// the source default, so a changed default reaches the tests instead of being
// restated here.

import { DEFAULT_KNOWLEDGE_TUNING, type PublicKnowledgeSettings } from '@src/shared/knowledge'

export function makePublicKnowledgeSettings(
  overrides: Partial<PublicKnowledgeSettings> = {}
): PublicKnowledgeSettings {
  return {
    ...DEFAULT_KNOWLEDGE_TUNING,
    hasWanikaniToken: false,
    encryptionAvailable: true,
    ...overrides
  }
}
