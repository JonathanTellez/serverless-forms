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

export function noShellInjection(value) {
  const shellPatterns = [
    /wget\s/i,
    /curl\s/i,
    /busybox/i,
    /\|\s*sh/i,
    /\|\s*bash/i,
    /`[^`]*`/,
    /\$\([^)]*\)/,
    /\/bin\/(sh|bash)/i,
  ];
  for (const pattern of shellPatterns) {
    if (pattern.test(value)) {
      return 'Field contains potentially unsafe shell content';
    }
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
  noShellInjection,
};

/**
 * Parses the ALLOWED_FIELDS env var string.
 *
 * Global format (single form):  "name,email,message,submit,thanks,token"
 * Per-token format (multi-form): "TOKEN1:name,email,message;TOKEN2:name,phone,email"
 *
 * @param {string} str
 * @returns {string[]|object} array of field names (global) or { [token]: string[] } (per-token)
 */
export function parseAllowedFields(str) {
  if (!str.includes(':')) {
    // Global list
    return str.split(',').map(f => f.trim()).filter(Boolean);
  }
  // Per-token map
  return str.split(';').reduce((acc, pair) => {
    const colonIndex = pair.indexOf(':');
    if (colonIndex === -1) return acc;
    const token = pair.slice(0, colonIndex).trim();
    const fields = pair.slice(colonIndex + 1).split(',').map(f => f.trim()).filter(Boolean);
    if (token && fields.length > 0) {
      acc[token] = fields;
    }
    return acc;
  }, {});
}

/**
 * Validates that submitted field names are all in the allowed list for the given token.
 * System fields (token, thanks, site, honey) are automatically excluded from the check.
 *
 * options.allowedFields format (env var string):
 * Global: "name,email,message"
 * Per-token: "TOKEN1:name,email,message;TOKEN2:name,phone,email"
 *
 * @param {object} fields - The form fields
 * @param {object} options - The options object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAllowedFields(fields, options) {
  if (!options.allowedFields) {
    return { valid: true, errors: [] };
  }

  let config = options.allowedFields;
  if (typeof config === 'string') {
    config = parseAllowedFields(config);
  }

  // Resolve allowed list: array (global) or object keyed by token
  let allowedList;
  if (Array.isArray(config)) {
    allowedList = config;
  } else {
    const token = fields[options.tokenField];
    allowedList = token ? config[token] : null;
    if (!allowedList) {
      return { valid: false, errors: [`No allowed fields configured for token: ${token}`] };
    }
  }

  // System fields are always permitted regardless of allowedList
  const systemFields = new Set([
    options.tokenField,
    options.thanksField,
    options.siteField,
    options.honeyField,
  ].filter(Boolean));

  const allowedSet = new Set(allowedList);
  const unknownFields = Object.keys(fields).filter(
    f => !systemFields.has(f) && !allowedSet.has(f)
  );

  if (unknownFields.length > 0) {
    return { valid: false, errors: [`Unknown fields not allowed: ${unknownFields.join(', ')}`] };
  }

  return { valid: true, errors: [] };
}

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
