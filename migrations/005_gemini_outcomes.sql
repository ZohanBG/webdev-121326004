-- The model provider is now Gemini, whose "overloaded" answer is 503 (Anthropic's was 529).
-- 529 stays allowed, so rows written before the switch remain valid.

ALTER TABLE suggestion_requests DROP CONSTRAINT suggestion_requests_outcome_check;
ALTER TABLE suggestion_requests ADD CONSTRAINT suggestion_requests_outcome_check
  CHECK (outcome IN ('ok', 'timeout', '429', '503', '529', 'truncated', 'invalid', 'error'));
