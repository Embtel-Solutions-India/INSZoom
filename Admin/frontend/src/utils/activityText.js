// Plain-words wording for activity / timeline lines that older entries stored the way the system wrote them (an internal id and a technical name).
// Used only when showing a line: nothing stored is changed. New entries are already written in plain words at the source.
export function plainActivityText(text) {
  const raw = String(text ?? '')
  // 'Opportunity JMgJeV4JzoeZYJwRSeVZ in "Immigrant Documentation pipeline"'  ->  'Case added to the Immigrant Documentation pipeline'
  const opportunity = raw.match(/^Opportunity\s+\S+\s+in\s+"(.+)"\s*$/i)
  if (opportunity) return `Case added to the ${opportunity[1]}`
  if (raw === 'GHL opportunity created') return 'Added to the pipeline'
  return raw
}
