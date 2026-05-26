// Validation rules - each rule is a function that returns null (pass) or an error message (fail)

export function noUrls(value) {
  if (/https?:\/\//i.test(value)) {
    return 'Field must not contain URLs (http or https)';
  }
  return null;
}

export function validEmail(value) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.(com\.co|com|co)$/i;
  if (!emailRegex.test(value)) {
    return 'Email must be from a valid domain (.com, .com.co, .co)';
  }
  return null;
}

export function noXss(value) {
  const xssPatterns = [
    /<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/i,
    /<[^>]+on\w+\s*=\s*["'][^"']*["']/i,
    /javascript\s*:/i,
    /<\s*iframe[\s\S]*?>/i,
    /<\s*img[^>]+src\s*=\s*["']?\s*javascript:/i,
    /data\s*:\s*text\s*\/\s*html/i,
    /<[^>]+(style|class)\s*=\s*["'][^"']*expression\s*\(/i,
  ];
  for (const pattern of xssPatterns) {
    if (pattern.test(value)) {
      return 'Field contains potentially unsafe content';
    }
  }
  return null;
}

const RULES = {
  noUrls,
  validEmail,
  noXss,
};

/**
 * Parses the validateFields env var string into a config object.
 *
 * Format: "field:rule,rule|field:rule,rule"
 * @example "email:validEmail,noXss|message:noUrls,noXss"
 *
 * @param {string} str
 * @returns {object} e.g. { email: ['validEmail', 'noXss'], message: ['noUrls', 'noXss'] }
 */
export function parseValidateFields(str) {
  const config = {};
  const parts = str.split('|');

  for (const part of parts) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const field = part.slice(0, colonIndex).trim();
    const rules = part.slice(colonIndex + 1).split(',').map(r => r.trim()).filter(Boolean);

    if (field.length === 0) {
      continue;
    }
    if (rules.length === 0) {
      continue;
    }

    config[field] = rules;
  }

  return config;
}

/**
 * Validates form fields based on options.validateFields config.
 *
 * options.validateFields format (env var string):
 * "field:rule,rule|field:rule,rule"
 * @example "email:validEmail,noXss|message:noUrls,noXss"
 *
 * @param {object} fields - The form fields
 * @param {object} options - The options object (reads options.validateFields)
 * @returns {{ valid: boolean, errors: object }} - Result with errors per field
 */
export function validateFields(fields, options) {
  if (!options.validateFields) {
    return { valid: true, errors: {} };
  }

  let config = options.validateFields;
  if (typeof config === 'string') {
    config = parseValidateFields(config);
  }

  const errors = {};

  for (const [field, ruleNames] of Object.entries(config)) {
    const value = fields[field];
    if (value === undefined || value === null || value === '') continue;

    for (const ruleName of ruleNames) {
      const rule = RULES[ruleName];
      if (!rule) {
        console.warn(`Unknown validation rule: ${ruleName}`);
        continue;
      }
      const error = rule(String(value));
      if (error !== null) {
        if (errors[field] === undefined) {
          errors[field] = [];
        }
        errors[field].push(error);
      }
    }
  }

  const valid = Object.keys(errors).length === 0;
  return { valid, errors };
}
