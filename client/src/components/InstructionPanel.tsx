import type { LimitsResponse } from '@mdw/shared';

export const EXAMPLE_INSTRUCTIONS = [
  'Compare the information across all uploaded documents',
  'Identify inconsistencies between the application form and supporting documents',
  'Extract key dates, obligations, financial values, and missing information',
  'Highlight discrepancies in names, addresses, licence details, or revenue figures',
] as const;

export interface InstructionPanelProps {
  value: string;
  onChange: (value: string) => void;
  limits: LimitsResponse | null;
  selectedCount: number;
  running: boolean;
  stageText: string | null;
  onAnalyse: () => void;
}

/** Instruction textarea, example chips, and the Analyse button with its stage text. */
export function InstructionPanel({
  value,
  onChange,
  limits,
  selectedCount,
  running,
  stageText,
  onAnalyse,
}: InstructionPanelProps) {
  const min = limits?.minInstructionChars ?? 5;
  const max = limits?.maxInstructionChars ?? 2000;
  const length = value.trim().length;
  const instructionValid = length >= min && length <= max;
  const canAnalyse = instructionValid && selectedCount > 0 && !running;

  let hint = `${value.length} / ${max} characters`;
  if (length > 0 && length < min) hint = `Enter at least ${min} characters.`;
  const hintIsError = length > 0 && length < min;

  return (
    <div className="instruction">
      <label htmlFor="instruction" className="field-label">
        Analysis instruction
      </label>
      <textarea
        id="instruction"
        rows={4}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={running}
        aria-describedby="instruction-hint"
        placeholder="Describe what to look for across the selected documents"
      />
      <p id="instruction-hint" className={`hint${hintIsError ? ' hint-error' : ''}`} aria-live="polite">
        {hint}
      </p>

      <div className="chips" role="group" aria-label="Example instructions">
        {EXAMPLE_INSTRUCTIONS.map((example) => (
          <button
            key={example}
            type="button"
            className="chip-button"
            onClick={() => onChange(example)}
            disabled={running}
          >
            {example}
          </button>
        ))}
      </div>

      <div className="analyse-row">
        <button type="button" className="btn btn-primary" onClick={onAnalyse} disabled={!canAnalyse}>
          {running ? 'Analysing…' : 'Analyse'}
        </button>
        {!running && selectedCount === 0 && (
          <span className="muted small">Select at least one processed document.</span>
        )}
        {!running && selectedCount > 0 && !instructionValid && length === 0 && (
          <span className="muted small">Write an instruction to continue.</span>
        )}
        {running && (
          <span role="status" aria-live="polite" className="stage-text">
            <span className="spinner" aria-hidden="true" /> {stageText}
          </span>
        )}
      </div>
    </div>
  );
}
