// Primary training target only; compound assistance is not converted to effective sets.
export const trainingTargets = {
  'incline-smith': '가슴', 'chest-press': '가슴', 'incline-machine-press': '가슴', 'cable-fly': '가슴',
  'mag-lat-pulldown': '등·광배', 'pullup-or-lat': '등·광배', 'one-arm-lat-pulldown': '등·광배', 'chest-supported-row': '등·두께',
  'cable-lateral': '측면어깨', 'shoulder-press': '전면어깨', 'reverse-pec-deck': '후면어깨',
  'overhead-triceps': '삼두', 'triceps-pushdown': '삼두', 'cable-curl': '이두',
  'leg-press': '하체·복합', 'bulgarian-split-squat': '하체·복합', 'db-rdl': '하체·후면', 'seated-leg-curl': '햄스트링', 'calf-raise': '종아리', 'countermovement-jump': '점프·파워',
}
export function countTargets(sets) {
  return sets.filter((s) => s.completed && !s.deletedAt && (s.setType ?? 'work') === 'work').reduce((result, set) => { const target = trainingTargets[set.exerciseId] ?? '미분류'; result[target] = (result[target] ?? 0) + 1; return result }, {})
}
