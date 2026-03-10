export function normaliseText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function detectFormType({ filename = '', documentText = '' }) {
  const file = normaliseText(filename);
  const doc = normaliseText(documentText);
  const combined = `${file} ${doc}`.trim();

  const candidates = [
    {
      formType: 'academic_dismissal_appeal',
      reference: 'ROF-05 Academic Dismissal Appeal Form',
      confidence: 0.9,
      keywords: [
        'academic dismissal appeal form',
        'rof-05',
        'dismissal appeal',
        'reason for appeal',
        'academic advisor',
        'semester results',
        'supporting evidence'
      ]
    },
    {
      formType: 'course_withdrawal',
      reference: 'Course Withdrawal Form',
      confidence: 0.82,
      keywords: [
        'course withdrawal',
        'withdraw from course',
        'w grade',
        'withdrawal form',
        'subject withdrawal'
      ]
    },
    {
      formType: 'postponement_of_studies',
      reference: 'Application for Postponement of Studies',
      confidence: 0.82,
      keywords: [
        'postponement of studies',
        'postpone studies',
        'deferment',
        'defer studies',
        'academic office',
        'vice president academic'
      ]
    }
  ];

  let best = {
    formType: 'unknown_form',
    reference: 'Academic Form',
    confidence: 0.4,
    signals: []
  };

  for (const candidate of candidates) {
    const hits = candidate.keywords.filter((keyword) => combined.includes(keyword));
    if (hits.length > best.signals.length) {
      best = {
        formType: candidate.formType,
        reference: candidate.reference,
        confidence: Math.min(candidate.confidence, 0.45 + hits.length * 0.12),
        signals: hits
      };
    }
  }

  if (best.formType !== 'unknown_form') {
    return best;
  }

  const genericFormSignals = [
    'student id',
    'signature',
    'date',
    'programme',
    'reason',
    'supporting documents',
    'faculty academic office'
  ].filter((keyword) => combined.includes(keyword));

  if (genericFormSignals.length >= 2) {
    return {
      formType: 'unknown_form',
      reference: 'Academic Form',
      confidence: 0.58,
      signals: genericFormSignals
    };
  }

  return best;
}
