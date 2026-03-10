export function normaliseText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyDocument({ message = '', filename = '', documentText = '' }) {
  const text = normaliseText(message);
  const file = normaliseText(filename);
  const doc = normaliseText(documentText);

  const formKeywords = [
    'form',
    'appeal',
    'dismissal',
    'rof',
    'withdrawal',
    'deferment',
    'postponement',
    'application',
    'reason for appeal',
    'signature',
    'student id'
  ];
{
  "current_mode": "form",
  "last_uploaded_filename": "SACHINDSHAN_Signed.pdf",
  "last_detected_document_type": "academic_form",
  "last_form_candidate": "Academic Dismissal Appeal Form",
  "last_programme": null,
  "last_cgpa": null,
  "last_credits": null
}
  const transcriptKeywords = [
    'transcript',
    'statement of results',
    'semester results',
    'result slip',
    'results slip',
    'cgpa',
    'gpa',
    'credit hours',
    'grade point',
    'academic standing',
    'semester'
  ];

  const graduationKeywords = [
    'graduate',
    'graduation',
    'eligible to graduate',
    'can i graduate',
    'credits remaining',
    'graduation check'
  ];

  let signals = [];
  let documentType = 'unknown_upload';
  let confidence = 0.35;

  if (containsAny(file, formKeywords) || containsAny(text, formKeywords) || containsAny(doc, formKeywords)) {
    documentType = 'form';
    confidence = 0.85;
    signals.push('form-like keywords detected');
  }

  if (containsAny(file, transcriptKeywords) || containsAny(text, transcriptKeywords) || containsAny(doc, transcriptKeywords)) {
    documentType = 'transcript';
    confidence = 0.9;
    signals.push('transcript-like keywords detected');
  }

  if (
    documentType === 'unknown_upload' &&
    (containsAny(text, graduationKeywords) || containsAny(doc, graduationKeywords))
  ) {
    documentType = 'graduation_document';
    confidence = 0.7;
    signals.push('graduation-related keywords detected');
  }

  return {
    documentType,
    confidence,
    signals
  };
}
