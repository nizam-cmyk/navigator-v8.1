import fs from 'fs';
import path from 'path';
import { classifyDocument, normaliseText as classifyNormaliseText } from './classify.js';
import { extractDocumentText } from './extract.js';
import { detectFormType } from '../utils/detectFormType.js';
import { buildSessionContext } from '../utils/buildSessionContext.js';
import { mergeContext } from '../utils/mergeContext.js';

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
    const incomingSessionContext = body?.sessionContext || {};

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

    const detectedForm = classification?.documentType === 'form'
      ? detectFormType({
          filename: fileMeta?.filename || '',
          message,
          documentText
        })
      : null;

    const detectedProgramme = detectProgramme(`${text} ${documentText}`.trim(), programmesData);
    const detectedCgpa = extractCgpa(`${text} ${documentText}`.trim());
    const detectedCredits = extractCredits(`${text} ${documentText}`.trim());

    const freshContext = buildSessionContext({
      currentMode: null,
      fileMeta,
      classification,
      formDetection: detectedForm,
      programme: detectedProgramme,
      cgpa: detectedCgpa,
      credits: detectedCredits,
      reference: detectedForm?.reference || detectedProgramme?.handbook_reference || null
    });

    let sessionContext = mergeContext(incomingSessionContext, freshContext);
    const mode = detectMode(text, fileMeta, classification, sessionContext);
    sessionContext = { ...sessionContext, current_mode: mode };

    let reply = '';
    switch (mode) {
      case 'form':
        reply = getFormResponse(text, documentText, formsData, handbookSections, sessionContext);
        break;
      case 'standing':
        reply = getStandingResponse(text, documentText, standingRules, handbookSections, sessionContext);
        break;
      case 'graduation':
        reply = getGraduationResponse(text, documentText, graduationData, programmesData, handbookSections, sessionContext);
        break;
      case 'transcript':
        reply = getTranscriptResponse(text, documentText, standingRules, graduationData, programmesData, handbookSections, sessionContext);
        break;
      case 'programme':
        reply = getProgrammeResponse(text, documentText, programmesData, handbookSections, sessionContext);
        break;
      case 'unknown_upload':
        reply = getUnknownUploadResponse(fileMeta, extracted, classification, sessionContext);
        break;
      default:
        reply = getFallbackResponse(handbookSections, handbookChunks, sessionContext);
    }

    return res.status(200).json({
      mode,
      classification,
      sessionContext,
      reply
    });
  } catch (error) {
    console.error('NAVIGATOR V8.1 error:', error);
    return res.status(200).json({
      mode: 'error',
      sessionContext: body?.sessionContext || {},
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

function detectMode(text, fileMeta, classification, sessionContext = {}) {
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
  const followUpHints = [
    'what should i fill in', 'what should i do next', 'what do i attach', 'where do i submit',
    'when is the deadline', 'what documents', 'can i submit this now', 'what should i fill first'
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

  if (containsAny(text, followUpHints) && sessionContext?.current_mode) {
    return sessionContext.current_mode;
  }
  if (!text && sessionContext?.current_mode) return sessionContext.current_mode;

  if (containsAny(text, formKeywords) || containsAny(filename, formKeywords)) return 'form';
  if (containsAny(text, standingKeywords) && !containsAny(text, transcriptKeywords)) return 'standing';
  if (containsAny(text, graduationKeywords)) return 'graduation';
  if (containsAny(text, transcriptKeywords)) return 'transcript';
  if (containsAny(text, programmeKeywords)) return 'programme';

  if (sessionContext?.last_document_type === 'form') return 'form';
  if (sessionContext?.last_document_type === 'transcript' && containsAny(text, graduationKeywords)) return 'graduation';
  if (sessionContext?.last_document_type === 'transcript') return 'transcript';

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

  if (!best && fallbackId) best = sections.find((section) => section.id === fallbackId) || null;
  return best;
}

function getStandingResponse(messageText, documentText, standingRules, handbookSections, sessionContext = {}) {
  const combined = `${messageText} ${documentText}`;
  const cgpa = extractCgpa(combined) ?? sessionContext?.last_cgpa ?? null;
  const rules = standingRules?.rules || {};
  const section = findSection(combined, handbookSections, 'academic_standing');

  if (cgpa === null) {
    return `NAVIGATOR · standing\n\nIssue Summary:\nYou are asking about academic standing, probation, or dismissal.\n\nHandbook Basis:\n- Good Status: CGPA 2.00 and above\n- Academic Probation: CGPA below 2.00\n- Academic Dismissal: may apply if CGPA remains below 2.00 for three consecutive semesters\n\nAssessment:\nNAVIGATOR can explain the standing rules, but your exact status cannot be interpreted unless your CGPA or official semester record is known.\n\nRecommended Action:\n1. Provide your CGPA if you want a preliminary interpretation.\n2. Check whether this is your first, second, or third consecutive semester below 2.00.\n3. Refer to the Faculty Academic Office for final confirmation.\n\nImportant Note:\nAcademic Dismissal cannot be concluded from one CGPA figure alone; the consecutive semester pattern must also be considered.\n\nReference:\n${section?.reference || 'Grading Systems and Academic Standing'}`;
  }

  let status = 'Academic risk';
  let explanation = `A CGPA of ${cgpa.toFixed(2)} is below the handbook threshold of 2.00, which places the student in academic risk territory and may result in Academic Probation, subject to the official semester record.`;
  if (cgpa >= (rules.good_status?.cgpa_min || 2.0)) {
    status = rules.good_status?.label || 'Good Status';
    explanation = `A CGPA of ${cgpa.toFixed(2)} is at or above the handbook threshold of 2.00 and is generally consistent with Good Status.`;
  }

  return `NAVIGATOR · standing\n\nIssue Summary:\nYou are asking whether a CGPA of ${cgpa.toFixed(2)} affects your academic standing.\n\nHandbook Basis:\n- Good Status: CGPA 2.00 and above\n- Probation: CGPA below 2.00 for any semester\n- Dismissal: may apply after three consecutive semesters below 2.00\n\nAssessment:\n${explanation}\n\nPreliminary Interpretation:\n${status}\n\nRecommended Action:\n1. Check whether this is your first, second, or third consecutive semester below 2.00.\n2. Review your official academic result notification.\n3. Meet your academic advisor or Faculty Academic Office for confirmation.\n\nImportant Note:\n${section?.safety_note || 'NAVIGATOR provides a handbook-based preliminary interpretation only.'}\n\nReference:\n${section?.reference || 'Grading Systems and Academic Standing'}`;
}

function getFormResponse(messageText, documentText, formsData, handbookSections, sessionContext = {}) {
  const combined = `${messageText} ${documentText}`.toLowerCase();
  const forms = formsData?.forms || [];

  const matchedForm =
    matchKnownForm(forms, sessionContext?.last_form_type) ||
    forms.find((form) => containsFormSignal(combined, form));

  if (!matchedForm) {
    return `NAVIGATOR · form\n\nIssue Summary:\nI could read this as a form-like academic document, but I am not yet fully confident about the exact form type.\n\nRecommended Action:\n1. Tell me the form title if visible.\n2. Tell me whether this is for dismissal appeal, withdrawal, or postponement.\n3. I will then continue using this same case context.\n\nReference:\nAcademic Forms and Procedures`;
  }

  const fields = (matchedForm.required_fields || []).map((item) => `- ${item}`).join('\n');
  const attachments = (matchedForm.required_attachments || []).length
    ? matchedForm.required_attachments.map((item) => `- ${item}`).join('\n')
    : '- Please confirm from the official form or Faculty Academic Office.';
  const submitTo = (matchedForm.submit_to || []).length
    ? matchedForm.submit_to.join(', ')
    : 'Please refer to the official form instructions.';

  return `NAVIGATOR · form\n\nForm Identified:\n${matchedForm.form_name}${matchedForm.form_code ? ` (${matchedForm.form_code})` : ''}\n\nPurpose:\n${matchedForm.purpose || 'Not specified.'}\n\nFields / Information to Prepare:\n${fields || '- Please refer to the official form.'}\n\nAttachments Required:\n${attachments}\n\nSubmission Guidance:\n1. Complete all required fields accurately.\n2. Attach all supporting documents.\n3. Submit to: ${submitTo}\n4. Follow the official deadline stated in the form or handbook.\n\nDeadline:\n${matchedForm.submission_deadline || matchedForm.submission_window || matchedForm.deadline_limit || 'Please confirm from the official document.'}\n\nImportant Caution:\nLate or incomplete submission may affect processing.\n\nAdditional Note:\n${matchedForm.post_approval_note || 'Final processing must follow the official Faculty / Registrar workflow.'}\n\nReference:\n${matchedForm.reference || matchedForm.form_name}`;
}

function containsFormSignal(combinedText, form) {
  const formName = (form.form_name || '').toLowerCase();
  const ref = (form.reference || '').toLowerCase();
  const code = (form.form_code || '').toLowerCase();
  const purpose = (form.purpose || '').toLowerCase();
  const keyPhrases = [formName, ref, code, purpose].filter(Boolean);
  return keyPhrases.some((phrase) => phrase && combinedText.includes(phrase)) ||
    (formName.includes('dismissal') && combinedText.includes('appeal')) ||
    (formName.includes('withdrawal') && combinedText.includes('withdraw')) ||
    (formName.includes('postponement') && (combinedText.includes('postpone') || combinedText.includes('defer')));
}

function matchKnownForm(forms, lastFormType) {
  if (!lastFormType) return null;
  const key = String(lastFormType).toLowerCase();
  if (key.includes('dismissal')) return forms.find((f) => (f.form_name || '').toLowerCase().includes('dismissal')) || null;
  if (key.includes('withdrawal')) return forms.find((f) => (f.form_name || '').toLowerCase().includes('withdrawal')) || null;
  if (key.includes('postponement')) return forms.find((f) => (f.form_name || '').toLowerCase().includes('postponement')) || null;
  return null;
}

function getGraduationResponse(messageText, documentText, graduationData, programmesData, handbookSections, sessionContext = {}) {
  const combined = `${messageText} ${documentText}`;
  const credits = extractCredits(combined) ?? sessionContext?.last_credits ?? null;
  const programme = detectProgramme(combined, programmesData) ||
    (sessionContext?.last_programme ? detectProgramme(sessionContext.last_programme, programmesData) : null);
  const rules = graduationData?.graduation_rules || [];
  const section = findSection(combined, handbookSections, programme ? null : 'programme_bse');

  if (!programme) {
    return `NAVIGATOR · graduation\n\nIssue Summary:\nYou are asking about graduation eligibility.\n\nRecommended Action:\n1. Please state your programme name.\n2. If available, also state your completed credits and CGPA.\n\nExample:\n“I am in Software Engineering and I have completed 109 credits.”\n\nImportant Note:\nA graduation check is more reliable when programme name, credits, and CGPA are provided.\n\nReference:\n${section?.reference || 'Programme Graduation Rules'}`;
  }

  const rule = rules.find((item) => item.programme_code === programme.code);
  if (!rule || rule.required_total_credits == null) {
    return `NAVIGATOR · graduation\n\nProgramme:\n${programme.name}\n\nIssue Summary:\nA preliminary graduation check is possible, but final eligibility cannot yet be fully confirmed for this programme in the current NAVIGATOR V8.1 knowledge map.\n\nReason:\nThe exact total graduating credits or full compulsory component structure is not yet fully mapped for this programme.\n\nRecommended Action:\n1. Confirm your completed credits and CGPA.\n2. Refer to the official programme structure and Faculty Academic Office for final confirmation.\n\nImportant Note:\nNAVIGATOR is still expanding programme-by-programme graduation coverage.\n\nReference:\n${programme.handbook_reference || 'FEST Academic Handbook'}`;
  }

  const remainingCredits = credits != null ? Math.max(rule.required_total_credits - credits, 0) : null;
  return `NAVIGATOR · graduation\n\nProgramme:\n${programme.name}\n\nIssue Summary:\nYou are asking whether your current credits are sufficient for graduation.\n\nHandbook Basis:\n- Required total credits: ${rule.required_total_credits}\n- Academic standing benchmark: CGPA ${rule.cgpa_min_for_good_status?.toFixed(2) || '2.00'}\n\nGraduation Checklist:\n- Credits completed: ${credits != null ? credits : 'Not provided'}\n- Required total credits: ${rule.required_total_credits}\n- Compulsory components: must also be completed\n- Academic standing: must remain acceptable under the handbook rules\n\nVerdict:\n${credits == null ? 'A final graduation check cannot be completed until your total completed credits are provided.' : credits >= rule.required_total_credits ? 'Based on total credits alone, you may be close to graduation eligibility. However, final confirmation still depends on compulsory components and official faculty verification.' : 'Based on the handbook-mapped credit requirement, you are not yet eligible to graduate.'}\n\nRemaining Requirement:\n${remainingCredits == null ? 'Please provide your completed credit count.' : `${remainingCredits} credit hour(s) remaining.`}\n\nImportant Note:\nFinal graduation confirmation depends not only on credit count, but also on compulsory component completion and official academic clearance.\n\nReference:\n${rule.handbook_reference || programme.handbook_reference || 'Programme Graduation Rules'}`;
}

function getProgrammeResponse(messageText, documentText, programmesData, handbookSections, sessionContext = {}) {
  const combined = `${messageText} ${documentText}`;
  const programme = detectProgramme(combined, programmesData) ||
    (sessionContext?.last_programme ? detectProgramme(sessionContext.last_programme, programmesData) : null);

  if (!programme) {
    return `NAVIGATOR · programme\n\nIssue Summary:\nYou are asking about a FEST programme.\n\nRecommended Action:\nPlease state the programme name more specifically, for example:\n- Civil Engineering\n- Software Engineering\n- Computer Science\n- Mechanical Engineering\n- Agricultural Science (Plantation Management)\n\nReference:\nFEST Programme Information`;
  }

  const entryReqs = (programme.entry_requirements?.length ? programme.entry_requirements.map((item) => `- ${item}`).join('\n') : '- Entry requirements for this programme are not yet fully structured in the current NAVIGATOR dataset.');
  const notes = (programme.programme_notes?.length ? programme.programme_notes.map((item) => `- ${item}`).join('\n') : '- No additional programme notes available.');

  return `NAVIGATOR · programme\n\nProgramme:\n${programme.name}\n\nDuration:\n${programme.duration || 'Not yet fully mapped in the current handbook dataset.'}\n\nMode of Study:\n${programme.mode_of_study || 'Not yet fully mapped in the current handbook dataset.'}\n\nTotal Credit Hours:\n${programme.total_credit_hours != null ? programme.total_credit_hours : 'Not yet fully mapped in the current handbook dataset.'}\n\nEntry Requirements:\n${entryReqs}\n\nProgramme Notes:\n${notes}\n\nImportant Note:\nSome programme fields may still be under expansion in NAVIGATOR V8.1.\n\nReference:\n${programme.handbook_reference || 'FEST Academic Handbook'}`;
}

function getTranscriptResponse(messageText, documentText, standingRules, graduationData, programmesData, handbookSections, sessionContext = {}) {
  const combined = `${messageText} ${documentText}`;
  const cgpa = extractCgpa(combined) ?? sessionContext?.last_cgpa ?? null;
  const credits = extractCredits(combined) ?? sessionContext?.last_credits ?? null;
  const programme = detectProgramme(combined, programmesData) ||
    (sessionContext?.last_programme ? detectProgramme(sessionContext.last_programme, programmesData) : null);

  return `NAVIGATOR · transcript\n\nTranscript Extract (Preliminary):\n- Programme: ${programme ? programme.name : 'Not identified'}\n- CGPA: ${cgpa != null ? cgpa.toFixed(2) : 'Not identified'}\n- Credits: ${credits != null ? credits : 'Not identified'}\n\nAssessment:\nThis transcript mode can use detected values to support handbook-based standing or graduation interpretation, but it is not yet a full transcript parser.\n\nRecommended Action:\n1. State your programme clearly if it was not detected.\n2. Provide CGPA and completed credits if known.\n3. Ask one focused question such as:\n   - “Am I on probation?”\n   - “Can I graduate?”\n\nImportant Note:\nFull transcript extraction and validation are planned for a later NAVIGATOR version.\n\nReference:\nTranscript Bridge Mode`;
}

function getUnknownUploadResponse(fileMeta, extracted, classification, sessionContext = {}) {
  return `NAVIGATOR · upload\n\nIssue Summary:\nI received a file upload${fileMeta?.filename ? ` (${fileMeta.filename})` : ''}, but I cannot yet determine confidently whether it is a transcript, academic form, or graduation-related document.\n\nWhat I detected:\n- Document type guess: ${classification?.documentType || 'unknown'}\n- Confidence: ${classification?.confidence != null ? classification.confidence : 'n/a'}\n- Extraction status: ${extracted?.success ? 'readable text detected' : (extracted?.reason || 'no readable text detected')}\n\nRecommended Action:\n1. Tell me what this uploaded file is.\n2. For example, say:\n   - “This is my transcript.”\n   - “This is a dismissal appeal form.”\n   - “This is for graduation checking.”\n\nImportant Note:\nNAVIGATOR V8.1 can use uploaded filename, extracted clues, and your prompt, but full file-content understanding is still being expanded.`;
}

function getFallbackResponse(handbookSections, handbookChunks, sessionContext = {}) {
  const activeContext = sessionContext?.current_mode ? `\n\nCurrent case context:\n${sessionContext.current_mode}` : '';
  return `NAVIGATOR\n\nI can currently help with:\n- programme information\n- entry requirements\n- academic standing\n- graduation eligibility\n- academic forms and appeals\n- transcript-related preliminary checks\n${activeContext}\n\nTry asking:\n- “What are the entry requirements for Civil Engineering?”\n- “My CGPA is 1.95. Am I on probation?”\n- “I am in Software Engineering and I have 109 credits. Can I graduate?”\n- “I uploaded a dismissal appeal form. What should I do?”\n\nVersion:\nNAVIGATOR V8.1 — Session-aware beta`;
}
