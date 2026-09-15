import CriterionCard from "./CriterionCard";

// The 8 O-1A/EB-1A criteria questions, rendered entirely from the backend
// definition (question set + 0–3 scale). One CriterionCard per question.
export default function CriteriaStep({ questions, answers, onChange, scoringConfig }) {
  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <CriterionCard
          key={q.key}
          question={q}
          value={answers[q.key]}
          onChange={(value) => onChange(q.key, value)}
          metThreshold={scoringConfig?.filingStrengthThreshold ?? 2}
          developableValue={scoringConfig?.developableThreshold ?? 1}
        />
      ))}
    </div>
  );
}
