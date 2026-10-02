export function validateReport(report) {
  if (!report || typeof report.headline !== 'string' || !report.headline.trim() || !Array.isArray(report.wins) || !Array.isArray(report.constraints) || !Array.isArray(report.changes) || !Array.isArray(report.nextActions) || report.nextActions.length > 3 || !report.nextActions.every((item) => typeof item.action === 'string' && typeof item.check === 'string')) throw new Error('리포트의 결론·잘한 점·제약·변화·다음 행동(최대 3개)을 확인해주세요.')
  for (const key of ['wins', 'constraints', 'changes']) if (!report[key].every((item) => typeof item === 'string')) throw new Error('리포트 문장 형식을 확인해주세요.')
  for (const key of ['exerciseTrends', 'trainingDistribution', 'recovery', 'evidence', 'uncertainties']) if (report[key] != null && (!Array.isArray(report[key]) || !report[key].every((item) => typeof item === 'string'))) throw new Error('리포트 근거는 문장 배열로 입력해주세요.')
  if (report.narrative != null && typeof report.narrative !== 'string') throw new Error('상세 설명은 문자열이어야 합니다.')
  if (report.confidence != null && !['low', 'medium', 'high', 'not-assessed'].includes(report.confidence)) throw new Error('확신도 형식을 확인해주세요.')
  return report
}
