import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComparisonTable } from './ComparisonTable';

describe('ComparisonTable', () => {
  it('shows Single source (not Yes) for a field that one document states', () => {
    render(
      <ComparisonTable
        table={{
          columns: ['a', 'b'],
          rows: [
            { field: 'Loan amount', values: { a: 'INR 75,00,000', b: null }, consistent: null },
            { field: 'Revenue', values: { a: '1', b: '2' }, consistent: false },
          ],
        }}
        documentNames={new Map([['a', 'form.pdf'], ['b', 'letter.txt']])}
      />,
    );
    expect(screen.getByText('Single source')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.queryByText('Yes')).toBeNull();
  });
});
