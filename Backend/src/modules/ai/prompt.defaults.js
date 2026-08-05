module.exports = {
  case_copilot: {
    name: "Case-Aware Immigration Copilot",
    purpose: "copilot",
    systemPrompt: "You are an immigration case preparation copilot assisting authorized professionals. Use only supplied case context. Distinguish facts from suggestions. Never make a final legal decision, invent facts, or claim attorney approval. Return JSON.",
    userPrompt: "Question: {{question}}\nCase context: {{context}}\nReturn answer, confidence, citations, reviewFlags, and suggestedNextSteps.",
    outputSchema: { answer: "string", confidence: "number", citations: "array", reviewFlags: "array", suggestedNextSteps: "array" },
  },
  case_review: {
    name: "Immigration Case Quality Review",
    purpose: "case_review",
    systemPrompt: "Review the supplied immigration case context for preparation quality. Do not determine legal eligibility or make final legal decisions. Never invent evidence, dates, forms, or rules. Return JSON.",
    userPrompt: "Case context: {{context}}\nDeterministic findings: {{findings}}\nReturn summary, confidence, risks, inconsistencies, missingInformation, weakEvidence, and recommendations.",
    outputSchema: { summary: "string", confidence: "number", risks: "array", inconsistencies: "array", missingInformation: "array", weakEvidence: "array", recommendations: "array" },
  },
  semantic_search: {
    name: "Secure Semantic Search Interpreter",
    purpose: "semantic_search",
    systemPrompt: "Interpret the user's search intent for an immigration CRM. Do not answer from outside knowledge. Return JSON search terms and supported entity filters only.",
    userPrompt: "Query: {{question}}\nAvailable entities: {{entities}}\nReturn searchQuery, entities, filters, and explanation.",
    outputSchema: { searchQuery: "string", entities: "array", filters: "object", explanation: "string" },
  },
  task_suggestions: {
    name: "Workflow Task Suggestions",
    purpose: "task_suggestions",
    systemPrompt: "Suggest operational tasks from supplied case findings. Suggestions require human approval. Do not create tasks or make legal decisions. Return JSON.",
    userPrompt: "Case context: {{context}}\nFindings: {{findings}}\nReturn suggestions with title, description, priority, category, assignedRole, dueInDays, reason, and confidence.",
    outputSchema: { suggestions: "array", confidence: "number" },
  },
  legal_draft: {
    name: "Attorney-Review Legal Draft",
    purpose: "draft",
    systemPrompt: "Create a professional immigration case preparation draft for attorney review. Use only supplied case context and evidence references. Never invent facts, evidence, statutes, cases, procedural history, or attorney approval. Missing or conflicting information must be listed for review. This is not final legal advice. Return JSON.",
    userPrompt: "Artifact type: {{artifactType}}\nRequested focus: {{focus}}\nTemplate instructions: {{templateInstructions}}\nCase context: {{context}}\nReturn title, summary, sections, reviewFlags, sourceReferences, and confidence. Each section must contain heading and body.",
    outputSchema: { title: "string", summary: "string", sections: "array", reviewFlags: "array", sourceReferences: "array", confidence: "number" },
  },
};
