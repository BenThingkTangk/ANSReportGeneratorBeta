-- ============================================================
-- PhysioPS × HumanOS ANS Reporting AI
-- Seed: 0001_colombo_ans_sources  (Akamai Managed PostgreSQL)
--
-- Curated, NON-PII knowledge corpus for RAG grounding: the 13 canonical
-- Dr. Joseph Colombo / DePace autonomic-medicine sources already curated for
-- this application (ported verbatim from supabase/migrations/0002 so provenance,
-- exact titles, authors, years, DOIs, claims, metrics and usage are preserved).
--
-- Rows 1-12 are PUBLISHED, peer-reviewed / editorially-published bibliographic
-- references (books + journal articles, each with a DOI or PubMed link).
-- Row 13 is the ONE internal item: a USER-PROVIDED verbatim transcript of Dr.
-- Colombo's own chart explanations. It is typed publication_type='internal_protocol'
-- (NOT 'book'/'journal_article'), so the grounding layer labels it
-- "(internal, non-peer-reviewed)" and never presents it as published evidence.
-- The corpus contains NO patient records, NO PHI, and MUST NOT be extended with
-- Jill or any other patient report. Do not invent medical content — every row
-- below already existed in the repo's curated Supabase seed.
--
-- IDEMPOTENT: keyed on lower(title) via uq_ans_knowledge_sources_title_ci, so
-- re-running never duplicates or overwrites operator edits.
-- ============================================================

INSERT INTO public.ans_knowledge_sources (
  id, title, authors, year, publication_type, journal, publisher, doi, url,
  abstract, key_claims, ans_metrics, tags, used_in,
  active_in_ai_analysis, active_in_report_citations, active_in_admin_review,
  review_status
) VALUES

-- 1. Clinical Autonomic Dysfunction (2019)
(
  gen_random_uuid(),
  'Clinical Autonomic Dysfunction: Measurement, Indications, Therapies, and Outcomes',
  'Nicholas L. DePace, Joseph Colombo',
  2019, 'book', NULL, 'Springer',
  '10.1007/978-3-030-17016-5',
  'https://link.springer.com/book/10.1007/978-3-030-17016-5',
  'Comprehensive guide to non-invasive autonomic nervous system testing using independent parasympathetic and sympathetic (P&S) monitoring. Covers measurement protocols, clinical indications, therapeutic protocols, and longitudinal outcomes from 5,000-patient Chicago cohort.',
  '["Independent measurement of parasympathetic (RFa) and sympathetic (LFa) activity is required for accurate ANS assessment.","LFa/RFa ratio between 0.4 and 3.0 defines the resting normal window; <0.4 is parasympathetic excess.","Six-phase test (Baseline, Deep Breathing, Recovery, Valsalva, Recovery, Stand) is the diagnostic standard."]'::jsonb,
  ARRAY['LFa','RFa','SB','HRV','BP','orthostatic_response','cardiovagal'],
  ARRAY['protocol','P&S','diagnostics','outcomes'],
  ARRAY['algorithm','AI prompt (synopsis)','AI prompt (ask-atom)','clinician report'],
  true, true, true, 'approved'
),

-- 2. Fatigue and Dysautonomia (2021)
(
  gen_random_uuid(),
  'Fatigue and Dysautonomia: A Hidden Connection',
  'Nicholas L. DePace, Joseph Colombo',
  2021, 'book', NULL, 'Springer',
  '10.1007/978-3-030-54632-2',
  'https://link.springer.com/book/10.1007/978-3-030-54632-2',
  'Connects chronic fatigue presentations to underlying autonomic dysfunction, with emphasis on parasympathetic excess as a precursor to chronic fatigue syndrome and fibromyalgia.',
  '["Parasympathetic excess during physical challenge is the fingerprint of chronic vagal over-activation.","Most chronic-fatigue patients present autonomic dysfunction before any cardiac findings."]'::jsonb,
  ARRAY['RFa','SB','PE'],
  ARRAY['fatigue','parasympathetic_excess','chronic_fatigue'],
  ARRAY['AI prompt (synopsis)','patient education'],
  true, true, true, 'approved'
),

-- 3. Long-COVID and the ANS (2023)
(
  gen_random_uuid(),
  'Long-COVID and the Autonomic Nervous System: The Journey to Dysautonomia',
  'Nicholas L. DePace, Joseph Colombo',
  2023, 'book', NULL, 'Springer',
  '10.1007/978-3-031-32263-6',
  'https://link.springer.com/book/10.1007/978-3-031-32263-6',
  'Documents the post-COVID dysautonomia phenotype — pre-clinical inflammation, autonomic neuropathy, POTS, and orthostatic intolerance — with P&S-guided treatment protocols.',
  '["Post-viral dysautonomia presents as POTS, orthostatic intolerance, or parasympathetic excess depending on the inflammatory trajectory.","Early P&S monitoring identifies post-COVID autonomic injury before standard cardiology workup."]'::jsonb,
  ARRAY['LFa','RFa','POTS','orthostatic_response'],
  ARRAY['long_covid','post_viral','POTS'],
  ARRAY['AI prompt (synopsis)','AI prompt (ask-atom)','clinician report'],
  true, true, true, 'approved'
),

-- 4. A Critical Analysis of Dysautonomia (2024)
(
  gen_random_uuid(),
  'A Critical Analysis of Dysautonomia',
  'Nicholas L. DePace, Joseph Colombo',
  2024, 'book', NULL, 'Springer',
  '10.1007/978-3-031-46896-9',
  'https://link.springer.com/book/10.1007/978-3-031-46896-9',
  'Critical review of dysautonomia phenotypes (CAN, POTS, OD, VVS, OI, OH) with diagnostic thresholds and differential algorithms.',
  '["Cardiovascular Autonomic Neuropathy (CAN) is defined by abnormal LFa, abnormal Ewing ratios, and abnormal orthostatic LFa response.","Vasovagal syncope presents with a flat 30:15 ratio and otherwise preserved sympathetic rise on stand."]'::jsonb,
  ARRAY['CAN','POTS','OD','VVS','Ewing_ratios'],
  ARRAY['dysautonomia','differential_diagnosis','CAN'],
  ARRAY['algorithm (indications)','AI prompt (ask-atom)','clinician report'],
  true, true, true, 'approved'
),

-- 5. Blood Pressure Variability (2024)
(
  gen_random_uuid(),
  'Blood Pressure Variability and Autonomic Dysfunction',
  'Nicholas L. DePace, Joseph Colombo',
  2024, 'book', NULL, 'Springer',
  '10.1007/978-3-031-49364-0',
  'https://link.springer.com/book/10.1007/978-3-031-49364-0',
  'Relationship between BP variability (BPV) and autonomic dysfunction; BPV as an early warning signal for cardiovascular events.',
  '["Elevated BPV correlates with autonomic neuropathy and predicts cardiovascular events independent of mean BP.","Combined P&S monitoring + BPV improves stratification of hypertensive patients."]'::jsonb,
  ARRAY['BP','BPV','LFa','CAN'],
  ARRAY['BPV','hypertension','cardiovascular_risk'],
  ARRAY['algorithm (BP overlays)','AI prompt (ask-atom)'],
  true, true, true, 'approved'
),

-- 6. P&S Monitoring Methodology (2008)
(
  gen_random_uuid(),
  'Parasympathetic and Sympathetic Monitoring (P&S Monitoring) — Methodology',
  'Joseph Colombo et al.',
  2008, 'journal_article', 'Clinical Autonomic Research', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/?term=Colombo+J+parasympathetic+sympathetic+monitoring',
  'Foundational methodology paper defining the wavelet-based independent P&S monitoring approach using the patient''s fundamental respiratory frequency.',
  '["Using the patient''s respiratory frequency as the RFa center (vs fixed 0.15-0.4 Hz HF band) yields valid measurements outside normal breathing ranges (athletes, COPD, panic disorder).","Morlet wavelet decomposition with 5-cycle window updated every 4 seconds is the spectral standard."]'::jsonb,
  ARRAY['LFa','RFa','FRF','spectral_method'],
  ARRAY['methodology','wavelet','FRF'],
  ARRAY['algorithm (spectral core)','AI prompt (synopsis)','AI prompt (ask-atom)'],
  true, true, true, 'approved'
),

-- 7. Agelink 2001 normative bands
(
  gen_random_uuid(),
  'Age-Continuous Normative Bands for HRV/LFa/RFa',
  'Agelink MW',
  2001, 'journal_article', 'Clinical Autonomic Research', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/?term=Agelink+heart+rate+variability+normal+values',
  'Aggregated normal values for HRV-derived autonomic indices across age, sex, and BMI.',
  '["RFa and LFa decline with age following a continuous P10/P90 envelope; tables form the basis for Colombo''s age bands."]'::jsonb,
  ARRAY['LFa','RFa','age_norms'],
  ARRAY['norms','age','Ewing'],
  ARRAY['algorithm (api/upload.ts age-banded P10/P90 norms)','patient report (WellnessBreakdown)'],
  true, true, true, 'approved'
),

-- 8. Gelber 1997 normative curves
(
  gen_random_uuid(),
  'Normative Heart Rate Variability — Gelber Aggregated Curves',
  'Gelber DA et al.',
  1997, 'journal_article', 'Diabetes Care', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/?term=Gelber+autonomic+normal+values',
  'Aggregated normative HRV values used alongside Agelink to define Colombo P10/P90 age bands.',
  '["HRV envelopes narrow with age and diabetes; used jointly with Agelink for Colombo age bands."]'::jsonb,
  ARRAY['HRV','SDNN','RMSSD'],
  ARRAY['norms','age','diabetes'],
  ARRAY['algorithm (api/upload.ts age-banded P10/P90 norms)','patient report (WellnessBreakdown)'],
  true, true, true, 'approved'
),

-- 9. Ewing Test Battery (1982)
(
  gen_random_uuid(),
  'Ewing Autonomic Test Battery',
  'Ewing DJ, Clarke BF',
  1982, 'journal_article', 'British Medical Journal', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/6805606/',
  'Original autonomic test battery (E/I ratio, Valsalva ratio, 30:15 ratio, orthostatic BP, isometric handgrip) — bedrock of autonomic medicine.',
  '["Composite Ewing battery is the time-domain reference standard for cardiac autonomic neuropathy (CAN)."]'::jsonb,
  ARRAY['EI_ratio','Valsalva_ratio','30_15_ratio','CAN'],
  ARRAY['Ewing','CAN','time_domain'],
  ARRAY['algorithm (Ewing ratios)','clinician report (EwingRatiosTable)'],
  true, true, true, 'approved'
),

-- 10. Prendergast 2001 ALA neuroprotection
(
  gen_random_uuid(),
  'Alpha-Lipoic Acid Neuroprotection in Autonomic Neuropathy',
  'Prendergast P',
  2001, 'journal_article', 'Clinical Autonomic Research', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/?term=Prendergast+alpha+lipoic+acid+autonomic',
  'ALA slows progression of autonomic neuropathy and helps restore autonomic balance.',
  '["ALA 600 mg/d is a non-prescription antioxidant specific for nerves; slows ANS neuropathy progression."]'::jsonb,
  ARRAY['LFa','neuropathy'],
  ARRAY['treatment','ALA','supplement'],
  ARRAY['algorithm (api/upload.ts line 2005 — therapy recommendation)','clinician therapy panel'],
  true, true, true, 'approved'
),

-- 11. Magidenko 2007 ALA BP contraindication
(
  gen_random_uuid(),
  'ALA Blood Pressure Contraindication',
  'Magidenko',
  2007, 'journal_article', 'Nutritional Reviews', NULL, NULL,
  'https://pubmed.ncbi.nlm.nih.gov/?term=Magidenko+alpha+lipoic+acid+blood+pressure',
  'Documents ALA contraindication in low baseline BP — risk of further hypotension.',
  '["ALA is contraindicated when baseline systolic BP is low."]'::jsonb,
  ARRAY['BP'],
  ARRAY['contraindication','ALA','BP'],
  ARRAY['algorithm (api/upload.ts line 1999 — contraindications)','clinician contraindications panel'],
  true, true, true, 'approved'
),

-- 12. Task Force HRV Standards (1996)
(
  gen_random_uuid(),
  'Heart Rate Variability — Standards of Measurement (Task Force)',
  'Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology',
  1996, 'journal_article', 'Circulation', NULL,
  '10.1161/01.CIR.93.5.1043',
  'https://www.ahajournals.org/doi/10.1161/01.CIR.93.5.1043',
  'International consensus standards for HRV measurement, time-domain and frequency-domain indices.',
  '["RMSSD and SDNN are the time-domain HRV gold standards; LF/HF ratio reflects sympathovagal balance with caveats."]'::jsonb,
  ARRAY['RMSSD','SDNN','LF','HF','LF/HF'],
  ARRAY['HRV','standards','Task_Force'],
  ARRAY['algorithm (HRV computation)','patient gauge (HRV/RMSSD/SDNN/LF/HF display)'],
  true, true, true, 'approved'
),

-- 13. Colombo 04-09-2026 Consultation Transcript
--     INTERNAL, user-provided, NON-PII, NON-peer-reviewed. Typed
--     'internal_protocol' so the AI grounding layer flags it as internal and
--     never cites it as published/peer-reviewed evidence.
(
  gen_random_uuid(),
  'Colombo P&S 04-09-2026 Clinical Consultation (Transcript)',
  'Joseph Colombo (Speaker 3)',
  2026, 'internal_protocol', NULL, NULL, NULL,
  'internal://04-09-Consultation_-AI-Driven-ANS_PNS-Data-Analysis-transcript.txt',
  'Verbatim plain-English explanations and analogies for every chart in the multi-parameter graphical report, captured directly from Dr. Colombo during the 04-09-2026 AI consultation.',
  '["Every chart explanation in client/src/lib/colomboAnalogies.ts is drawn from this transcript.","Includes the ''brakes vs accelerator'' analogy, the ''Chicago 5,000-patient cohort'' outcome data, and the 36-hour stroke case."]'::jsonb,
  ARRAY['all'],
  ARRAY['internal','consultation','transcript','analogies'],
  ARRAY['clinician explainers (14 charts)','AI prompt (ask-atom — system prompt grounding)'],
  true, true, true, 'approved'
)

ON CONFLICT (lower(title)) DO NOTHING;
