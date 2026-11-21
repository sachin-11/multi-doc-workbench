import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Finding } from '@mdw/shared';
import { FindingCard } from './FindingCard';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const FACT_A = '33333333-3333-4333-8333-333333333333';
const FACT_B = '44444444-4444-4444-8444-444444444444';

const finding: Finding = {
  id: "55555555-5555-4555-8555-555555555555",
  analysisId: "66666666-6666-4666-8666-666666666666",
  type: 'discrepancy',
  title: 'annual_revenue differs between documents',
  description: 'The documents state different values.',
  severity: 'high',
  sources: [
    { documentId: DOC_A, factId: FACT_A, snippet: 'Annual Revenue: INR 50,00,000' },
    { documentId: DOC_B, factId: FACT_B, snippet: 'Annual Revenue: INR 42,00,000' },
  ],
  isInterpretation: true,
};

describe('FindingCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows both source documents as badges and the AI tag', () => {
    render(
      <FindingCard
        finding={finding}
        documentNames={
          new Map([
            [DOC_A, 'application.txt'],
            [DOC_B, 'financials.txt'],
          ])
        }
      />,
    );

    expect(screen.getByRole('button', { name: /application\.txt/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /financials\.txt/ })).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.queryByText(/No source/)).toBeNull();
  });
});
