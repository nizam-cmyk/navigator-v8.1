export async function extractDocumentText({ filename = '', rawText = '' }) {
  try {
    const cleaned = String(rawText || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return {
        success: false,
        text: '',
        reason: `No readable document text extracted from ${filename || 'uploaded file'}.`
      };
    }

    return {
      success: true,
      text: cleaned,
      reason: null
    };
  } catch (error) {
    return {
      success: false,
      text: '',
      reason: `Document extraction failed: ${error.message}`
    };
  }
}
