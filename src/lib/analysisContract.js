// Server contract only. Workout mutations and routine mutations are deliberately absent.
export const ANALYSIS_CONTRACT_VERSION = 1
export const analysisOutputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    observations: { type: 'array', items: { type: 'string' } },
    progress: { type: 'string' }, recoverySignals: { type: 'array', items: { type: 'string' } },
    nextSessionSuggestions: { type: 'array', items: { type: 'string' } },
    routineProposals: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    narrative: { type: 'string' },
  },
  required: ['observations', 'progress', 'recoverySignals', 'nextSessionSuggestions', 'routineProposals', 'evidence', 'confidence', 'narrative'],
}

export function createAnalysisGateway(client) {
  return {
    async request({ sessionIds, from, to, soccerSchedule = [] }) {
      if (!Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 100 || sessionIds.some((id) => typeof id !== 'string')) throw new Error('분석할 세션을 선택해주세요.')
      const { data, error } = await client.functions.invoke('analyze-workouts', {
        body: { contractVersion: ANALYSIS_CONTRACT_VERSION, sessionIds, from, to, soccerSchedule },
      })
      if (error) throw error
      return data
    },
  }
}
