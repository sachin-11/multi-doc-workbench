import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnalysisResult, DocumentMeta, LimitsResponse } from '@mdw/shared';
import { App } from './App';

/*
 * Happy path through the real components, with fetch answered by fixtures. Two processed text files are
 * uploaded, the example instruction is used, the analysis runs, and the results, copy and source links work.
 */

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const FACT_A = '33333333-3333-4333-8333-333333333333';
const FACT_B = '44444444-4444-4444-8444-444444444444';
const ANALYSIS_ID = '55555555-5555-4555-8555-555555555555';
const FINDING_ID = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-11-21T10:00:00.000Z';

const LIMITS: LimitsResponse = {
  maxFiles: 10,
  maxFileSizeMb: 10,
  allowedExtensions: ['.pdf', '.txt', '.csv', '.png', '.jpg', '.jpeg'],
  maxDocumentsPerAnalysis: 10,
  minInstructionChars: 5,
  maxInstructionChars: 2000,
};

function meta(id: string, name: string, status: DocumentMeta['status']): DocumentMeta {
  return {
    id,
    originalName: name,
    sanitizedName: name,
    mimeType: 'text/plain',
    format: 'txt',
    sizeBytes: 120,
    status,
    errorMessage: null,
    charCount: 60,
    wasTruncated: false,
    createdAt: NOW,
  };
}

const RESULT: AnalysisResult = {
  id: ANALYSIS_ID,
  instruction: 'Highlight discrepancies in names, addresses, licence details, or revenue figures',
  status: 'completed',
  documentIds: [DOC_A, DOC_B],
  perDocumentFacts: {
    [DOC_A]: [
      {
        id: FACT_A,
        documentId: DOC_A,
        key: 'annual_revenue',
        value: 'INR 50,00,000',
        normalizedValue: '5000000',
        category: 'financial',
        sourceSnippet: 'Annual Revenue: INR 50,00,000',
        confidence: 0.9,
      },
    ],
    [DOC_B]: [
      {
        id: FACT_B,
        documentId: DOC_B,
        key: 'annual_revenue',
        value: 'INR 42,00,000',
        normalizedValue: '4200000',
        category: 'financial',
        sourceSnippet: 'Annual Revenue: INR 42,00,000',
        confidence: 0.9,
      },
    ],
  },
  findings: [
    {
      id: FINDING_ID,
      analysisId: ANALYSIS_ID,
      type: 'discrepancy',
      title: 'annual_revenue differs between documents',
      description: 'The documents state different values.',
      severity: 'high',
      sources: [
        { documentId: DOC_A, factId: FACT_A, snippet: 'Annual Revenue: INR 50,00,000' },
        { documentId: DOC_B, factId: FACT_B, snippet: 'Annual Revenue: INR 42,00,000' },
      ],
      isInterpretation: true,
    },
  ],
  comparisonTable: {
    columns: [DOC_A, DOC_B],
    rows: [{ field: 'annual_revenue', values: { [DOC_A]: 'INR 50,00,000', [DOC_B]: 'INR 42,00,000' }, consistent: false }],
  },
  summary: 'Compared 2 document(s) across 1 extracted field(s).',
  missingInformation: [],
  provider: 'mock',
  warnings: [],
  errorMessage: null,
  createdAt: NOW,
  completedAt: NOW,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Routes fetch by method and path. Documents become processed on the second list call, which exercises polling. */
function installFetch(): { listCalls: () => number } {
  let listCalls = 0;
  let docs: DocumentMeta[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url === '/api/limits') return jsonResponse(LIMITS);

    if (url === '/api/documents' && method === 'GET') {
      listCalls += 1;
      if (docs.length > 0 && listCalls >= 2) {
        docs = docs.map((d) => ({ ...d, status: 'processed' as const, charCount: 60 }));
      }
      return jsonResponse({ documents: docs });
    }

    if (url === '/api/documents' && method === 'POST') {
      docs = [meta(DOC_A, 'application.txt', 'uploaded'), meta(DOC_B, 'financials.txt', 'uploaded')];
      return jsonResponse({ accepted: docs, rejected: [] });
    }

    if (url === `/api/documents/${DOC_A}` || url === `/api/documents/${DOC_B}`) {
      return jsonResponse({
        ...(docs.find((d) => url.endsWith(d.id)) ?? meta(DOC_A, 'application.txt', 'processed')),
        pages: null,
        rows: null,
        columns: null,
        warnings: [],
        preview: null,
      });
    }

    if (url === '/api/analyses' && method === 'POST') return jsonResponse(RESULT);

    if (url === `/api/analyses/${ANALYSIS_ID}/export?format=markdown`) {
      return new Response('# Document analysis\n\n- Source: application.txt', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown' },
      });
    }

    return jsonResponse({ error: { code: 'NOT_FOUND', message: `Unexpected request ${method} ${url}` } }, 404);
  });
  vi.stubGlobal('fetch', mock);
  return { listCalls: () => listCalls };
}

describe('App happy path (fetch answered by fixtures)', () => {
  beforeEach(() => {
    // jsdom does not implement scrolling or the clipboard, so both are stubbed.
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uploads, waits for processing, analyses, shows sourced results, copies, and jumps to facts', async () => {
    installFetch();
    render(<App />);

    expect(await screen.findByText(/No documents yet/)).toBeTruthy();

    const input = screen.getByLabelText('Choose documents to upload') as HTMLInputElement;
    const files = [
      new File(['Annual Revenue: INR 50,00,000'], 'application.txt', { type: 'text/plain' }),
      new File(['Annual Revenue: INR 42,00,000'], 'financials.txt', { type: 'text/plain' }),
    ];
    fireEvent.change(input, { target: { files } });

    // Polling moves both documents from "Queued" to "Ready".
    expect(await screen.findAllByText('Ready', {}, { timeout: 5000 })).toHaveLength(2);
    const includeA = screen.getByRole('checkbox', { name: 'Include application.txt in the analysis' }) as HTMLInputElement;
    expect(includeA.checked).toBe(true);

    // Example chip fills the instruction, and Analyse becomes enabled.
    fireEvent.click(screen.getByRole('button', { name: 'Highlight discrepancies in names, addresses, licence details, or revenue figures' }));
    const analyse = screen.getByRole('button', { name: 'Analyse' }) as HTMLButtonElement;
    await waitFor(() => expect(analyse.disabled).toBe(false));
    fireEvent.click(analyse);

    // Results arrive. The AI tag and both source badges are on the discrepancy card.
    const discrepancyTab = await screen.findByRole('tab', { name: /Discrepancies \(1\)/ });
    fireEvent.click(discrepancyTab);
    const card = await screen.findByRole('article');
    expect(within(card).getByText('AI')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /application\.txt/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /financials\.txt/ })).toBeTruthy();
    expect(screen.getByText('Provider: Mock')).toBeTruthy();

    // Copy as Markdown calls the export endpoint and writes the text to the clipboard.
    fireEvent.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    expect(await screen.findByText('Copied as Markdown')).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Document analysis\n\n- Source: application.txt');

    // Clicking a source badge switches to the Extracted facts tab and opens that document.
    fireEvent.click(within(card).getByRole('button', { name: /financials\.txt/ }));
    const factsTab = screen.getByRole('tab', { name: 'Extracted facts' });
    await waitFor(() => expect(factsTab.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('button', { name: /financials\.txt/, expanded: true })).toBeTruthy();
  });
});
