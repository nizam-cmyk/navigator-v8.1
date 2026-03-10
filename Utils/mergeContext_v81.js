export function mergeContext(previousContext = null, nextContext = null) {
  const prev = previousContext || {};
  const next = nextContext || {};

  return {
    current_mode: next.current_mode || prev.current_mode || 'general',
    last_uploaded_filename: next.last_uploaded_filename || prev.last_uploaded_filename || null,
    last_document_type: next.last_document_type || prev.last_document_type || null,
    last_form_type: next.last_form_type || prev.last_form_type || null,
    last_programme: next.last_programme || prev.last_programme || null,
    last_programme_code: next.last_programme_code || prev.last_programme_code || null,
    last_cgpa: next.last_cgpa ?? prev.last_cgpa ?? null,
    last_credits: next.last_credits ?? prev.last_credits ?? null,
    last_reference: next.last_reference || prev.last_reference || null,
    last_document_excerpt: next.last_document_excerpt || prev.last_document_excerpt || null,
    last_updated: next.last_updated || new Date().toISOString()
  };
}
