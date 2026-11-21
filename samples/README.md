# Sample documents

A fully **fictional** document set for a business loan application. The company (Nimbus Agro Foods Pvt Ltd), the people, the licence numbers and the figures are all invented. The identifiers are obviously fake (`FSL-TEST-0042`, `+91-00000-00000`, example.com addresses). No real person, company or banking data is in this folder.

The set has **deliberate, known discrepancies**. [EXPECTED_FINDINGS.md](EXPECTED_FINDINGS.md) lists every planted item, which files are involved, and whether the MOCK provider detects it. Use it as a demo script and a manual test checklist.

## Files

| File | Type | Purpose |
|---|---|---|
| `application_form.pdf` | PDF | Loan application form (the primary document) |
| `supporting_letter.txt` | TXT | Confirmation letter with name, address, licence and revenue variants |
| `financials_fy2025.csv` | CSV | Long-form financial table (`metric`, `fy2024`, `fy2025`) |
| `kyc_summary.txt` | TXT | Short KYC summary: a company-name variant, a missing co-director, no revenue |
| `invalid_samples/fake.pdf` | TXT renamed to .pdf | Must be rejected (content does not match the type) |
| `invalid_samples/empty.txt` | 0 bytes | Must be rejected (empty file) |
| `invalid_samples/script.exe` | Text with an .exe name | Must be rejected (unsupported type). Never run. |
| `invalid_samples/notes.docx` | Text with a .docx name | Must be rejected (unsupported type) |

The four valid files are the ones to upload for analysis. The `invalid_samples/` files are only for the error demo.

## Regenerate and load

```bash
npm run samples:generate   # rewrites the files in samples/ from scripts/generate-samples.ts (idempotent)
npm run seed               # loads the four valid samples into the local database, through the real pipeline
```

- `samples:generate` builds the PDF with pdfkit. The generator is the source of truth for all sample files. Re-running it changes nothing when the content is the same.
- `seed` uses the same validation, repository, buffer store and processor as the upload route. It skips any sample already in the database. Run it after the first start, or after `npm run db:reset`.

Then start the app (`npm run dev`) and analyse the four valid files with:

> Highlight discrepancies in names, addresses, licence details, or revenue figures

## Automated check

`server/src/analysis/samples.test.ts` runs these files through the real code, with the MOCK provider. It checks the planted discrepancies, the consistent company name and the rejected invalid files. Run it with `npm test`.
