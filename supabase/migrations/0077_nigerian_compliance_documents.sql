-- ═══════════════════════════════════════════════════════════════════════════
-- What a Nigerian real-estate agency actually has to hold.
--
--   CAC certificate    Corporate Affairs Commission. Company registration.
--                      Federal, mandatory.  (already: cac_certificate)
--   SCUML certificate  The EFCC's anti-money-laundering registration for
--                      designated non-financial businesses. Every real-estate
--                      business must hold one BEFORE trading. Federal,
--                      mandatory, and the enum had no value for it.
--   ESVARBON           Estate Surveyors and Valuers Registration Board of
--                      Nigeria. The statutory board; registration is the
--                      licence to practise.
--   NIESV              Nigerian Institution of Estate Surveyors and Valuers.
--                      The professional body; membership is the credential.
--   State licence      LASRERA in Lagos, and each state's own scheme
--                      elsewhere. See 0078 for why this one needs a state.
--
-- frcn_membership stays in the enum. FRCN is the Financial Reporting Council
-- of Nigeria -- a corporate-reporting regulator, not a register of estate
-- practitioners -- so it was the wrong body to ask for. PostgreSQL cannot
-- drop an enum value, and a firm that does hold one has somewhere to put it.
-- It is simply not asked for during onboarding.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
-- it, which is why nothing here reads these labels.
-- ═══════════════════════════════════════════════════════════════════════════
alter type document_type add value if not exists 'scuml_certificate';
alter type document_type add value if not exists 'esvarbon_registration';
alter type document_type add value if not exists 'niesv_membership';
