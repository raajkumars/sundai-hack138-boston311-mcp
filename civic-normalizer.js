// Domain normalization used by the Boston 311 Purpose Pack's model step.
// The language model performs only a narrow paraphrase; stable routing rules
// remain deterministic and independently testable.

export function locationOf(text) {
  const match = text.match(/\b(?:on|at|near)\s+([A-Z][\w'&]*(?:\s+(?:and|&)\s+[A-Z][\w'&]*|\s+(?:St|Ave|Rd|Blvd|Street|Avenue|Road|Boulevard|Ln|Lane|Sq|Square|Way)\b)?)/)
  return match ? match[1].trim() : ''
}

const CATEGORY_RULES = [
  { category: 'Rodent Sighting', test: /\b(rat|rats|rodent|mice|mouse)\b/i },
  { category: 'Needle Cleanup', test: /\bneedle/i },
  { category: 'Abandoned Bicycle', test: /abandon\w*.*(bike|bicycle)|(bike|bicycle).*abandon/i },
  { category: 'Abandoned Vehicle', test: /abandon\w*.*(car|vehicle|truck)|(car|vehicle|truck).*abandon/i },
  { category: 'Damaged Sign', test: /\bsign\b.*(broken|damaged|down|missing|knocked)|\b(broken|damaged)\b.*\bsign\b/i },
  { category: 'Traffic Signal', test: /\b(traffic light|streetlight|signal|stoplight)\b/i },
  { category: 'Illegal Parking', test: /\b(park(ed|ing)?|blocking|double.?park)\b/i },
]

export function classifyCategory(text) {
  return CATEGORY_RULES.find((rule) => rule.test.test(text))?.category || 'Other'
}

export function parseExtraction(reply, rawText) {
  const line = (reply.match(/Output:\s*(.+)/i)?.[1] || reply.split('\n')[0] || '').trim()
  const description = (line || rawText).replace(/^["']|["']$/g, '').slice(0, 100)
  return { description, category: classifyCategory(rawText), location: locationOf(rawText) }
}
