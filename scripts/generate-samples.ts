/**
 * Generates the synthetic sample document set in samples/.
 *
 * Everything here is FICTIONAL: the company, people, licence numbers and figures are invented.
 * The PDF is built with pdfkit so the repo ships the generator as well as the output.
 * Run with: npm run samples:generate
 *
 * Idempotent: a file is rewritten only when its bytes change. The PDF uses fixed metadata dates,
 * so re-running produces the same bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.resolve(here, '..', 'samples');
const INVALID_DIR = path.join(SAMPLES_DIR, 'invalid_samples');

/** Fixed metadata date so the PDF is byte-identical on every run. */
const FIXED_DATE = new Date('2026-11-05T00:00:00Z');
const SYNTHETIC_NOTE = 'SYNTHETIC SAMPLE. All names, identifiers and figures are invented for testing.';

// ---------------------------------------------------------------------------
// 1. Application form (PDF). Planted: name, address, licence expiry, revenue.
// ---------------------------------------------------------------------------
const FORM_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['Applicant Name', 'Rohan Mehta'],
  ['Company', 'Nimbus Agro Foods Pvt Ltd'],
  ['Registered Address', '14 Lotus Park, Sector 21, Gurugram, Haryana 122016'],
  ['Trade Licence No', 'FSL-TEST-0042'],
  ['Licence Expiry', '31-03-2027'],
  ['Annual Revenue FY2025', 'INR 4,80,00,000'],
  ['Loan Amount Requested', 'INR 75,00,000'],
  ['Tenure', '5 years'],
  ['Application Date', '05-11-2026'],
  ['Director', 'Rohan Mehta'],
  ['Co-director', 'Ananya Kapoor'],
];

function renderApplicationForm(): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: 'Business loan application (synthetic sample)',
      Author: 'Synthetic sample generator',
      CreationDate: FIXED_DATE,
      ModDate: FIXED_DATE,
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.font('Helvetica-Bold').fontSize(16).text('Business Loan Application');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text(SYNTHETIC_NOTE);
  doc.moveDown(1.2).fillColor('#000000');

  for (const [label, value] of FORM_FIELDS) {
    doc.font('Helvetica-Bold').fontSize(11).text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value);
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(9).fillColor('#555555').text('Synthetic sample for software testing only.');
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// 2. Supporting letter (TXT). Planted: name (Mehra), address (Sector 12),
//    revenue (3,95,00,000), licence expiry (2026), obligation (term loan EMI).
// ---------------------------------------------------------------------------
const SUPPORTING_LETTER = `SUPPORTING CONFIRMATION LETTER (SYNTHETIC SAMPLE - NOT A REAL DOCUMENT)

${SYNTHETIC_NOTE}

Regarding the business loan application of Nimbus Agro Foods Pvt Ltd.

We confirm the following details of the applicant, based on the records shared with us.

Applicant: Rohan Mehra
Company: Nimbus Agro Foods Pvt Ltd
Address: 14 Lotus Park, Sector 12, Gurugram
Licence No: FSL-TEST-0042
Licence Expiry: 31-03-2026
Revenue FY2025: INR 3,95,00,000
Existing obligation: term loan EMI of INR 1,20,000 per month until 30-06-2028

The revenue figure is provisional and is subject to the final audit of FY2025.

[Signature block omitted in this synthetic sample]
`;

// ---------------------------------------------------------------------------
// 3. Financials (CSV). Planted: third revenue value. No licence or address.
//    Indian-format numbers are quoted so the commas are not read as column separators.
// ---------------------------------------------------------------------------
const FINANCIALS_CSV = `metric,fy2024,fy2025
revenue,"3,60,00,000","4,10,00,000"
net_profit,"18,50,000","24,00,000"
total_liabilities,"1,92,00,000","2,35,00,000"
existing_debt,"55,00,000","48,00,000"
cash_and_equivalents,"9,20,000","11,40,000"
`;

// ---------------------------------------------------------------------------
// 4. KYC summary (TXT). Planted: co-director missing, no revenue.
//    Company name uses a formatting variant ("Private Limited"), which should count as consistent.
// ---------------------------------------------------------------------------
const KYC_SUMMARY = `KYC SUMMARY (SYNTHETIC SAMPLE)

${SYNTHETIC_NOTE}

Company name: Nimbus Agro Foods Private Limited
Directors: Rohan Mehta

No revenue figure is recorded in this summary.
This summary was prepared from partial records.
`;

// ---------------------------------------------------------------------------
// 5. Invalid samples, for the graceful error demo. None of these is ever executed.
// ---------------------------------------------------------------------------
const INVALID_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  // Plain text with a .pdf name: must fail the magic-byte check.
  ['fake.pdf', 'This is plain text renamed to .pdf. It is not a real PDF file.\n'],
  // Zero bytes: must fail the empty-file check.
  ['empty.txt', ''],
  // Unsupported extensions: must fail the extension allowlist. Contents are harmless text.
  ['script.exe', 'Placeholder text named like an executable. It is never run.\n'],
  ['notes.docx', 'Placeholder text named like a Word file. It is not a real .docx.\n'],
];

// ---------------------------------------------------------------------------

type WriteOutcome = 'created' | 'updated' | 'unchanged';

/** Writes only when the bytes differ, so re-running the generator is a no-op. */
function writeIfChanged(filePath: string, bytes: Buffer): WriteOutcome {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return 'created';
  }
  if (fs.readFileSync(filePath).equals(bytes)) {
    return 'unchanged';
  }
  fs.writeFileSync(filePath, bytes);
  return 'updated';
}

async function main(): Promise<void> {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  fs.mkdirSync(INVALID_DIR, { recursive: true });

  const outputs: Array<[string, Buffer]> = [
    [path.join(SAMPLES_DIR, 'application_form.pdf'), await renderApplicationForm()],
    [path.join(SAMPLES_DIR, 'supporting_letter.txt'), Buffer.from(SUPPORTING_LETTER, 'utf8')],
    [path.join(SAMPLES_DIR, 'financials_fy2025.csv'), Buffer.from(FINANCIALS_CSV, 'utf8')],
    [path.join(SAMPLES_DIR, 'kyc_summary.txt'), Buffer.from(KYC_SUMMARY, 'utf8')],
    ...INVALID_SAMPLES.map(([name, text]): [string, Buffer] => [
      path.join(INVALID_DIR, name),
      Buffer.from(text, 'utf8'),
    ]),
  ];

  for (const [filePath, bytes] of outputs) {
    const outcome = writeIfChanged(filePath, bytes);
    console.log(`${outcome.padEnd(9)} ${path.relative(path.resolve(here, '..'), filePath)} (${bytes.length} bytes)`);
  }
}

main().catch((err: unknown) => {
  console.error('Sample generation failed:', err);
  process.exitCode = 1;
});
