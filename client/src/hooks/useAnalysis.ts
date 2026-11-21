import { useCallback, useEffect, useState } from 'react';
import type { AnalysisResult } from '@mdw/shared';
import { runAnalysis } from '../api/client';

/** Stage labels shown while the single synchronous request is in flight. */
export const STAGE_LABELS = [
  'Extracting facts per document…',
  'Comparing across documents…',
] as const;

/** Switch to the second label after this long. The server does not report stages, so this is an estimate. */
const STAGE_SWITCH_MS = 4000;

export type AnalysisState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: number }
  | { kind: 'done'; result: AnalysisResult }
  | { kind: 'error'; message: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'The analysis failed.';
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ kind: 'idle' });

  useEffect(() => {
    if (state.kind !== 'running' || state.stage > 0) return;
    const timer = setTimeout(() => setState({ kind: 'running', stage: 1 }), STAGE_SWITCH_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const run = useCallback(async (documentIds: readonly string[], instruction: string) => {
    setState({ kind: 'running', stage: 0 });
    try {
      const result = await runAnalysis(documentIds, instruction);
      setState({ kind: 'done', result });
    } catch (err) {
      setState({ kind: 'error', message: errorText(err) });
    }
  }, []);

  return { state, run };
}
