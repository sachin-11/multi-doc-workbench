# M8 — Synthetic sample documents

**Status:** Not started

## Goal
Realistic demo inputs that exercise the analysis. All data is invented.

## Scope
- `samples/application-form.pdf`: applicant name, address, licence number, date of birth, declared revenue.
- `samples/supporting-statement.txt`: a letter that restates some details, with one different address and one different licence date.
- `samples/financials.csv`: revenue by quarter, with one total that does not match the form.
- Each file has a short note of the deliberate mismatches (kept in `samples/README.md`) so the reviewer can verify findings.
- Optional: a seed script that loads these into SQLite.

## Deliverables
- [ ] Three sample files
- [ ] Expected-findings list in `samples/README.md`

## Acceptance
- Running the app with these 3 files produces at least 2 discrepancies and at least 1 missing-information item.
- No real names, addresses, or company data.
