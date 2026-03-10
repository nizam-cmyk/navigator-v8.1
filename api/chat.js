import fs from 'fs';
import path from 'path';
import { classifyDocument, normaliseText as classifyNormaliseText } from './classify.js';
import { extractDocumentText } from './extract.js';

function readJson(filename) {
  const filePath = path.join(process.cwd(), 'data', filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

const standingRules = readJson('standing_rules.json');
const formsData = readJson('forms.json');
const programmesData = readJson('programmes.json');
const graduationData = readJson('graduation_rules.json');
const handbookSections = readJson('handbook_sections.json');
const handbookChunks = readJson('handbook_chunks.json');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Method not allowed.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const message = body?.message || '';
    const fileMeta = body?.fileMeta || null;
    const rawText = body?.documentText || '';

    const text = normaliseText(message);
    const extracted = await extractDocumentText({
      filename: fileMeta?.filename || '',
      rawText
    });
    const documentText = normaliseText(extracted?.text || '');

    const classification = classifyDocument({
      message,
      filename: fileMeta?.filename || '',
      documentText
    });

    const mode = detectMode(text, fileMeta, classification);

    let reply = '';
    switch (mode) {
      case 'form':
        reply = getFormResponse(text, documentText, formsData, handbookSections);
        break;
      case 'standing':
        reply = getStandingResponse(text, documentText, standingRules, handbookSections);
        break;
      case 'graduation':
        reply = getGraduationResponse(text, documentText, graduationData, programmesData, handbookSections);
        break;
      case 'transcript':
        reply = getTranscriptResponse(text, documentText, standingRules, graduationData, programmesData, handbookSections);
        break;
      case 'programme':
        reply = getProgrammeResponse(text, documentText, programmesData, handbookSections);
        break;
      case 'unknown_upload':
        reply = getUnknownUploadResponse(fileMeta, extracted, classification);
        break;
      default:
        reply = getFallbackResponse(handbookSections, handbookChunks);
    }

    return res.status(200).json({
      mode,
      classification,
      reply
    });
  } catch (error) {
    console.error('NAVIGATOR V8 error:', error);
    return res.status(200).json({
      mode: 'error',
      reply: 'NAVIGATOR encountered an internal error while processing your request. Please try again.'
    });
  }
}

function normaliseText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function detectMode(text, fileMeta, classification) {
  const filename = normaliseText(fileMeta?.filename || '');

  const standingKeywords = [
    'probation', 'dismissal', 'dismissed', 'academic standing', 'good standing',
    'am i on probation', 'will i be dismissed', 'cgpa'
  ];
  const graduationKeywords = [
    'graduate', 'graduation', 'eligible to graduate', 'can i graduate',
    'credits remaining', 'completed credits', 'total credits'
  ];
  const programmeKeywords = [
    'entry requirement', 'duration', 'programme structure', 'total credit hours',
    'civil engineering', 'software engineering', 'computer science',
    'information technology', 'agricultural science', 'automotive',
    'mechanical engineering', 'electronics engineering'
  ];
  const transcriptKeywords = [
    'transcript', 'statement of results', 'semester results', 'result slip', 'results slip'
  ];
  const formKeywords = [
    'form', 'appeal', 'dismissal appeal', 'application', 'withdrawal form',
    'deferment', 'postponement', 'rof-'
  ];

  if (fileMeta?.filename) {
    if (classification?.documentType === 'form') return 'form';
    if (classification?.documentType === 'transcript') {
      if (containsAny(text, graduationKeywords)) return 'graduation';
      return 'transcript';
    }
    if (classification?.documentType === 'graduation_document') return 'graduation';
    return 'unknown_upload';
  }

  if (containsAny(text, formKeywords) || containsAny(filename, formKeywords)) return 'form';
  if (containsAny(text, standingKeywords) && !containsAny(text, transcriptKeywords)) return 'standing';
  if (containsAny(text, graduationKeywords)) return 'graduation';
  if (containsAny(text, transcriptKeywords)) return 'transcript';
  if (containsAny(text, programmeKeywords)) return 'programme';
  return 'general';
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractCgpa(text) {
  const match = text.match(/cgpa\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i);
  return match ? parseFloat(match[1]) : null;
}

function extractCredits(text) {
  const patterns = [
    /(\d+)\s*credits?/i,
    /total credits earned\s*(?:is|=|:)?\s*(\d+)/i,
    /completed credit hours\s*(?:is|=|:)?\s*(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function detectProgramme(text, programmes) {
  const items = programmes?.programmes || [];
  for (const programme of items) {
    if ((programme.aliases || []).some((alias) => text.includes(normaliseText(alias)))) {
      return programme;
    }
  }
  return null;
}

function findSection(text, handbookSections, fallbackId = null) {
  const sections = handbookSections?.sections || [];
  const normalized = classifyNormaliseText(text);
  let best = null;
  let bestScore = 0;

  for (const section of sections) {
    const score = (section.keywords || []).reduce((acc, keyword) => {
      return acc + (normalized.includes(classifyNormaliseText(keyword)) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }

  if (!best && fallbackId) {
    best = sections.find((section) => section.id === fallbackId) || null;
  }
  return best;
}

function getStandingResponse(messageText, documentText, standingRules, handbookSections) {
  const combined = `${messageText} ${documentText}`;
  const cgpa = extractCgpa(combined);
  const rules = standingRules?.rules || {};
  const section = findSection(combined, handbookSections, 'academic_standing');

  if (cgpa === null) {
    return `NAVIGATOR · standing

Issue Summary:
You are asking about academic standing, probation, or dismissal.

Handbook Basis:
- Good Status: CGPA 2.00 and above
- Academic Probation: CGPA below 2.00
- Academic Dismissal: may apply if CGPA remains below 2.00 for three consecutive semesters

Assessment:
NAVIGATOR can explain the standing rules, but your exact status cannot be interpreted unless your CGPA or official semester record is known.

Recommended Action:
1. Provide your CGPA if you want a preliminary interpretation.
2. Check whether this is your first, second, or third consecutive semester below 2.00.
3. Refer to the Faculty Academic Office for final confirmation.

Important Note:
Academic Dismissal cannot be concluded from one CGPA figure alone; the consecutive semester pattern must also be considered.

Reference:
${section?.reference || 'Grading Systems and Academic Standing'}`;
  }

  let status = 'Academic risk';
  let explanation = `A CGPA of ${cgpa.toFixed(2)} is below the handbook threshold of 2.00, which places the student in academic risk territory and may result in Academic Probation, subject to the official semester record.`;

  if (cgpa >= (rules.good_status?.cgpa_min || 2.0)) {
    status = rules.good_status?.label || 'Good Status';
    explanation = `A CGPA of ${cgpa.toFixed(2)} is at or above the handbook threshold of 2.00 and is generally consistent with Good Status.`;
  }

  return `NAVIGATOR · standing

Issue Summary:
You are asking whether a CGPA of ${cgpa.toFixed(2)} affects your academic standing.

Handbook Basis:
- Good Status: CGPA 2.00 and above
- Probation: CGPA below 2.00 for any semester
- Dismissal: may apply after three consecutive semesters below 2.00

Assessment:
${explanation}

Preliminary Interpretation:
${status}

Recommended Action:
1. Check whether this is your first, second, or third consecutive semester below 2.00.
2. Review your official academic result notification.
3. Meet your academic advisor or Faculty Academic Office for confirmation.

Important Note:
${section?.safety_note || 'NAVIGATOR provides a handbook-based preliminary interpretation only.'}

Reference:
${section?.reference || 'Grading Systems and Academic Standing'}`;
}

function getFormResponse(messageText, documentText, formsData, handbookSections) {
  const combined = `${messageText} ${documentText}`;
  const forms = formsData?.forms || [];
  const matchedForm =
    forms.find((form) => (form.form_name || '').toLowerCase().includes('dismissal') && combined.includes('dismiss')) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('withdrawal') && combined.includes('withdraw')) ||
    forms.find((form) => (form.form_name || '').toLowerCase().includes('postponement') && (combined.includes('postpone') || combined.includes('defer')));

  const section = findSection(combined, handbookSections, 'dismissal_appeal');

  if (!matchedForm) {
    return `NAVIGATOR · form

Issue Summary:
You are asking about an academic form, application, or appeal document.

Recommended Action:
1. State the exact form name, or upload a file with the form title clearly shown.
2. NAVIGATOR can then provide the form purpose, required fields, attachments, and submission steps.

Examples:
- Academic Dismissal Appeal Form
- Course Withdrawal Form
- Application for Postponement of Studies

Reference:
${section?.reference || 'Academic Forms and Procedures'}`;
  }

  const fields = (matchedForm.required_fields || []).map((item) => `- ${item}`).join('\n');
  const attachments = (matchedForm.required_attachments || []).length
    ? matchedForm.required_attachments.map((item) => `- ${item}`).join('\n')
    : '- Please confirm from the official form or Faculty Academic Office.';
  const submitTo = (matchedForm.submit_to || []).length
    ? matchedForm.submit_to.join(', ')
    : 'Please refer to the official form instructions.';

  return `NAVIGATOR · form

Form Identified:
${matchedForm.form_name}${matchedForm.form_code ? ` (${matchedForm.form_code})` : ''}

Purpose:
${matchedForm.purpose || 'Not specified.'}

Fields / Information to Prepare:
${fields || '- Please refer to the official form.'}

Attachments Required:
${attachments}

Submission Guidance:
1. Complete all required fields accurately.
2. Attach all supporting documents.
3. Submit to: ${submitTo}
4. Follow the official deadline stated in the form or handbook.

Deadline:
${matchedForm.submission_deadline || matchedForm.submission_window || matchedForm.deadline_limit || 'Please confirm from the official document.'}

Important Caution:
Late or incomplete submission may affect processing.

Additional Note:
${matchedForm.post_approval_note || section?.safety_note || 'Final processing must follow the official Faculty / Registrar workflow.'}

Reference:
${matchedForm.reference || section?.reference || matchedForm.form_name}`;
}

function getGraduationResponse(messageText, documentText, graduationData, programmesData, handbookSections) {
  const combined = `${messageText} ${documentText}`;
  const credits = extractCredits(combined);
  const programme = detectProgramme(combined, programmesData);
  const rules = graduationData?.graduation_rules || [];
  const section = findSection(combined, handbookSections, 'programme_bse');

  if (!programme) {
    return `NAVIGATOR · graduation

Issue Summary:
You are asking about graduation eligibility.

Recommended Action:
1. Please state your programme name.
2. If available, also state your completed credits and CGPA.

Example:
“I am in Software Engineering and I have completed 109 credits.”

Important Note:
A graduation check is more reliable when programme name, credits, and CGPA are provided.

Reference:
Programme Graduation Rules`;
  }

  const rule = rules.find((item) => item.programme_code === programme.code);

  if (!rule || rule.required_total_credits == null) {
    return `NAVIGATOR · graduation

Programme:
${programme.name}

Issue Summary:
A preliminary graduation check is possible, but final eligibility cannot yet be fully confirmed for this programme in the current NAVIGATOR V8 knowledge map.

Reason:
The exact total graduating credits or full compulsory component structure is not yet fully mapped for this programme.

Recommended Action:
1. Confirm your completed credits and CGPA.
2. Refer to the official programme structure and Faculty Academic Office for final confirmation.

Important Note:
NAVIGATOR is still expanding programme-by-programme graduation coverage.

Reference:
${programme.handbook_reference || section?.reference || 'FEST Academic Handbook'}`;
  }

  const remainingCredits = credits != null ? Math.max(rule.required_total_credits - credits, 0) : null;

  return `NAVIGATOR · graduation

Programme:
${programme.name}

Issue Summary:
You are asking whether your current credits are sufficient for graduation.

Handbook Basis:
- Required total credits: ${rule.required_total_credits}
- Academic standing benchmark: CGPA ${rule.cgpa_min_for_good_status?.toFixed(2) || '2.00'}

Graduation Checklist:
- Credits completed: ${credits != null ? credits : 'Not provided'}
- Required total credits: ${rule.required_total_credits}
- Compulsory components: must also be completed
- Academic standing: must remain acceptable under the handbook rules

Verdict:
${credits == null
  ? 'A final graduation check cannot be completed until your total completed credits are provided.'
  : credits >= rule.required_total_credits
    ? 'Based on total credits alone, you may be close to graduation eligibility. However, final confirmation still depends on compulsory components and official faculty verification.'
    : 'Based on the handbook-mapped credit requirement, you are not yet eligible to graduate.'}

Remaining Requirement:
${remainingCredits == null ? 'Please provide your completed credit count.' : `${remainingCredits} credit hour(s) remaining.`}

Important Note:
Final graduation confirmation depends not only on credit count, but also on compulsory component completion and official academic clearance.

Reference:
${rule.handbook_reference || programme.handbook_reference || section?.reference || 'Programme Graduation Rules'}`;
}

function getProgrammeResponse(messageText, documentText, programmesData, handbookSections) {
  const combined = `${messageText} ${documentText}`;
  const programme = detectProgramme(combined, programmesData);
  const section = findSection(combined, handbookSections, 'programme_bse');

  if (!programme) {
    return `NAVIGATOR · programme

Issue Summary:
You are asking about a FEST programme.

Recommended Action:
Please state the programme name more specifically, for example:
- Civil Engineering
- Software Engineering
- Computer Science
- Mechanical Engineering
- Agricultural Science (Plantation Management)

Reference:
FEST Programme Information`;
  }

  const entryReqs = (programme.entry_requirements?.length
    ? programme.entry_requirements.map((item) => `- ${item}`).join('\n')
    : '- Entry requirements for this programme are not yet fully structured in the current NAVIGATOR dataset.');
  const notes = (programme.programme_notes?.length
    ? programme.programme_notes.map((item) => `- ${item}`).join('\n')
    : '- No additional programme notes available.');

  return `NAVIGATOR · programme

Programme:
${programme.name}

Duration:
${programme.duration || 'Not yet fully mapped in the current handbook dataset.'}

Mode of Study:
${programme.mode_of_study || 'Not yet fully mapped in the current handbook dataset.'}

Total Credit Hours:
${programme.total_credit_hours != null ? programme.total_credit_hours : 'Not yet fully mapped in the current handbook dataset.'}

Entry Requirements:
${entryReqs}

Programme Notes:
${notes}

Important Note:
Some programme fields may still be under expansion in NAVIGATOR V8.

Reference:
${programme.handbook_reference || section?.reference || 'FEST Academic Handbook'}`;
}

function getTranscriptResponse(messageText, documentText, standingRules, graduationData, programmesData, handbookSections) {
  const combined = `${messageText} ${documentText}`;
  const cgpa = extractCgpa(combined);
  const credits = extractCredits(combined);
  const programme = detectProgramme(combined, programmesData);
  const standingSection = findSection(combined, handbookSections, 'academic_standing');
  const programmeSection = findSection(combined, handbookSections, 'programme_bse');

  return `NAVIGATOR · transcript

Transcript Extract (Preliminary):
- Programme: ${programme ? programme.name : 'Not identified'}
- CGPA: ${cgpa != null ? cgpa.toFixed(2) : 'Not identified'}
- Credits: ${credits != null ? credits : 'Not identified'}

Assessment:
This transcript mode can use detected values to support handbook-based standing or graduation interpretation, but it is not yet a full transcript parser.

Recommended Action:
1. State your programme clearly if it was not detected.
2. Provide CGPA and completed credits if known.
3. Ask one focused question such as:
   - “Am I on probation?”
   - “Can I graduate?”

Important Note:
Full transcript extraction and validation are planned for a later NAVIGATOR version.

Reference:
${standingSection?.reference || programmeSection?.reference || 'Transcript Bridge Mode'}`;
}

function getUnknownUploadResponse(fileMeta, extracted, classification) {
  return `NAVIGATOR · upload

Issue Summary:
I received a file upload${fileMeta?.filename ? ` (${fileMeta.filename})` : ''}, but I cannot yet determine whether it is a transcript, academic form, or graduation-related document.

Recommended Action:
1. Tell me what this uploaded file is.
2. For example, say:
   - "This is my transcript."
   - "This is a dismissal appeal form."
   - "This is for graduation checking."

Processing Note:
${extracted?.success ? 'The document extraction layer is available, but no clear academic document type was matched.' : extracted?.reason || 'No document text was available for classification.'}

Classification Confidence:
${classification?.confidence != null ? classification.confidence : 'N/A'}

Important Note:
NAVIGATOR V8 can use the uploaded filename, your prompt, and extracted text when available, but full file-content reading is still being expanded.`;
}

function getFallbackResponse(handbookSections, handbookChunks) {
  const standing = handbookSections?.sections?.find((section) => section.id === 'academic_standing');
  const chunkHint = handbookChunks?.chunks?.[0]?.topic || 'academic handbook topics';

  return `NAVIGATOR

I can currently help with:
- programme information
- entry requirements
- academic standing
- graduation eligibility
- academic forms and appeals
- uploaded academic documents (beta)

Try asking:
- “What are the entry requirements for Civil Engineering?”
- “My CGPA is 1.95. Am I on probation?”
- “I am in Software Engineering and I have 109 credits. Can I graduate?”
- “I uploaded a dismissal appeal form. What should I do?”

Reference:
${standing?.reference || 'FEST Academic Handbook'}

Version:
NAVIGATOR V8.0 — Document-Aware Handbook Beta (${chunkHint})`;
}
