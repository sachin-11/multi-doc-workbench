# Expected findings for the synthetic sample set

Every item below is a planted, known result. Use this file in two ways:

1. **Manual test checklist.** Upload the four valid samples, run the analysis with the instruction below, and tick each item when you see it.
2. **Demo script.** The reviewer can check each claim against the source file in a minute.

All names, identifiers and figures are fictional. The company is **Nimbus Agro Foods Pvt Ltd** (fictional).

## Files and the analysis instruction

| File | Format | What it is |
|---|---|---|
| `application_form.pdf` | PDF | Business loan application (the primary form) |
| `supporting_letter.txt` | TXT | Auditor-style confirmation letter, with name, address, licence and revenue variants |
| `financials_fy2025.csv` | CSV | Financial metrics for FY2024 and FY2025 (long-form table) |
| `kyc_summary.txt` | TXT | Short KYC summary, with a company-name variant and no revenue |

Instruction to use for the run (also what the automated test uses):

> Highlight discrepancies in names, addresses, licence details, or revenue figures

The comparison table, the discrepancies and the missing-information items are computed in code from the extracted facts, so the result below is the same with the MOCK provider (no `LLM_API_KEY`) and with a real model, as long as the extraction finds the same facts. A real model also writes the summary and may add extra findings.

## A. Planted discrepancies (must be flagged)

| # | Field | Values by file | Severity (expected) | Files involved | Mock detects? |
|---|---|---|---|---|---|
| D1 | Applicant name | `application_form.pdf`: **Rohan Mehta**. `supporting_letter.txt`: **Rohan Mehra**. `kyc_summary.txt` (director): **Rohan Mehta** | high | application form, supporting letter, KYC summary | ✅ yes (the finding lists each document with its own value) |
| D2 | Registered address | Form: **14 Lotus Park, Sector 21**, Gurugram, Haryana 122016. Letter: **14 Lotus Park, Sector 12**, Gurugram | medium | application form, supporting letter | ✅ yes |
| D3 | Licence expiry | Form: **31-03-2027**. Letter: **31-03-2026** | medium | application form, supporting letter | ✅ yes |
| D4 | Revenue FY2025 | Form: **INR 4,80,00,000**. Letter: **INR 3,95,00,000**. Financials CSV: **4,10,00,000** | high | application form, supporting letter, financials CSV | ✅ yes (all three values, all three documents) |

Also check that D3 is a *licence detail* problem, not only a date mismatch. The letter's licence is dated 31-03-2026, which is before the report date (2026-11-21), so it has **probably expired**. See section E.

## B. Consistent items (must NOT be flagged as discrepancies)

| # | Field | Values | Expected treatment | Mock detects? |
|---|---|---|---|---|
| C1 | Company name | Form: "Nimbus Agro Foods **Pvt Ltd**". KYC: "Nimbus Agro Foods **Private Limited**" (and the letter's "Pvt Ltd") | Same company. Formatting variant, not a discrepancy | ✅ not flagged. Reported as a low-severity match ("agree once formatting is ignored") |
| C2 | Licence number | Form and letter: **FSL-TEST-0042** | Consistent | ✅ not flagged |
| C3 | Director | Form: **Rohan Mehta**. KYC: **Rohan Mehta** | Consistent. Part of the applicant / director name field (see D1) | ✅ the two agree. The letter's applicant is what differs |

## C. Planted missing information (must be reported)

| # | Missing item | Where it is stated | Where it is missing | Mock detects? |
|---|---|---|---|---|
| M1 | **Co-director** (Ananya Kapoor) | Application form | KYC summary (and the letter and CSV) | ✅ yes |
| M2 | **Revenue FY2025** | Form, letter, CSV | **KYC summary** ("No revenue figure is recorded") | ✅ yes |
| M3 | **Licence details** | Form, letter | **KYC summary and financials CSV** (neither has a licence field) | ✅ yes |
| M4 | **Registered address** | Form, letter | **KYC summary and financials CSV** (neither has an address field) | ✅ yes |
| M5 | **Loan amount requested** (INR 75,00,000) and **tenure** (5 years) | Form only | Letter, CSV, KYC | ➖ not reported. These are not among the important fields, so they appear in the comparison table only |

Only important fields are checked for gaps: names, address, licence number and expiry, revenue and the co-director. A field is reported when at least one document states it and another does not. A statement such as "No revenue figure is recorded" counts as a gap, not as a value. A prior-year figure that only one document carries (revenue FY2024 in the CSV) is not reported as a gap. On the sample set this gives about seven items: the planted ones above, plus the applicant and company name missing from the CSV.

## D. Obligations

| # | Item | Where | Expected treatment | Mock detects? |
|---|---|---|---|---|
| O1 | Existing term loan EMI: **INR 1,20,000 per month until 30-06-2028** | Supporting letter (`Existing obligation:`) | Captured as a financial obligation fact and cited to the letter | ⚠️ captured as a fact (`existing_obligation`) and a missing-info entry for the other files. It is **not** summarised as an obligation in the summary. A real LLM would call it out. |

## E. Needs a real LLM (the mock cannot judge these)

| # | Item | Why the mock misses it |
|---|---|---|
| L1 | **Licence probably expired.** Letter says 31-03-2026, which is before the report date | The mock compares values as text. It does not compare dates with today's date. A real LLM can say "expired as of today". |
| L2 | **Revenue is provisional** (letter: "subject to the final audit of FY2025") | This is a sentence, not a labelled field. The mock does not read prose qualifiers. |
| L3 | **EMI obligation affects the loan** (see O1) | Interpretation of how an obligation affects the request. The mock only lists the fact. |

Items L1 to L3 are the reason a real provider is worth running on this set. They are not expected from the MOCK.

## F. Invalid files (graceful error demo)

Upload the four files in `samples/invalid_samples/`. Each must be **rejected**, with a reason. None is ever run or executed.

| File | Problem | Expected code | Expected reason (text is shown in the UI) |
|---|---|---|---|
| `fake.pdf` | Plain text renamed to `.pdf` | `SIGNATURE_MISMATCH` | "File content does not match a valid .pdf file." |
| `empty.txt` | Zero bytes | `EMPTY_FILE` | "File is empty." |
| `script.exe` | Unsupported extension | `UNSUPPORTED_EXTENSION` | ".exe is not supported. Allowed: .pdf, .txt, .csv, .png, .jpg, .jpeg." |
| `notes.docx` | Unsupported extension | `UNSUPPORTED_EXTENSION` | ".docx is not supported. Allowed: ..." |

Upload all four in **one** request. The response should have 0 accepted and 4 rejected, and the other valid files in a mixed batch should still be accepted (partial success).

## G. Manual checklist

- [ ] `npm run samples:generate` runs and reports `unchanged` on a second run (idempotent).
- [ ] `npm run seed` reports four `processed` samples. `application_form.pdf` contains `FSL-TEST-0042`.
- [ ] Analysis with the instruction above completes with status `completed`.
- [ ] D1 applicant name discrepancy, with two sources.
- [ ] D2 address discrepancy, with two sources.
- [ ] D3 licence expiry discrepancy, with two sources.
- [ ] D4 revenue discrepancy, with **three** sources and the three values in its description.
- [ ] C1 company name is **not** a discrepancy.
- [ ] M1 co-director is reported as missing from the KYC summary.
- [ ] M2 revenue is reported as missing from the KYC summary.
- [ ] Every finding shows at least one source document (provenance).
- [ ] Each invalid file in section F is rejected with the stated reason.

## Automated coverage

`server/src/analysis/samples.test.ts` and `server/test/analysis.samples.e2e.test.ts` run sections A, B, C and F through the real validation, parser and analysis code with the MOCK provider. They fail if a planted discrepancy disappears, if a document's value is paired with the wrong document, if the revenue discrepancy loses one of its three values, if the co-director or licence gap is not reported, if the comparison table is missing, if the company variant is flagged, or if an invalid file is accepted. Section D and section E are not asserted, because the mock is not expected to produce them.
