# Nigeria Synthetic Real Estate AI Dataset

Generated: 2026-06-29  
Country: Nigeria  
Currency: Nigerian Naira (NGN, ₦)

This package contains fictional data designed to test a real estate AI assistant that analyzes uploaded property, housing, rental, and customer conversation data, then recommends a small number of suitable listings instead of showing hundreds of properties.

## Files

- `nigeria_real_estate_ai_test_data.xlsx` — Main workbook with formulas, dashboard, market data, rental comps, personas, and evaluation cases.
- `nigeria_real_estate_listings.csv` — Machine-friendly listing table with computed columns as static values.
- `nigeria_real_estate_eval_cases.jsonl` — Conversation test cases with expected shortlist IDs and evaluation focus.

## Workbook sheets

1. `Dashboard` — Summary metrics and charts.
2. `Settings_NG` — Editable assumptions for mortgage/down payment, vacancy, and management fees.
3. `Listings_NG` — 120 synthetic Nigerian listings with formula-driven yield, cash flow, risk, and fit scores.
4. `Market_Data_NG` — 48 synthetic Nigerian area-level market records.
5. `Rental_Comps_NG` — 180 synthetic rent comparables.
6. `Personas` — 12 customer profiles/personas.
7. `Conversation_Eval_Cases` — 30 customer-prompt test cases.
8. `Data_Dictionary` — Field meanings and usage notes.

## Important safety note

All listings, addresses, prices, rents, risks, and scores are synthetic. They do not represent real properties, valuations, legal title status, rent evidence, or investment advice.

## Suggested AI behavior to test

The AI should filter hard constraints first, return only 3–5 recommended listings, explain tradeoffs, surface due-diligence warnings, and use the rental comps and market rows when reasoning about yield and location fit.
