/**
 * Creates a logger bound to a specific form submission.
 * Each call generates a short unique ID so all log lines from the same
 * form processing cycle share the same prefix and can be correlated.
 *
 * @example
 * const log = createLogger(fields, options);
 * log.info('Processing form');
 * log.warn('Validation failed', errors);
 * log.error('SMTP error', err);
 *
 * Output:
 * [form:a3f9|token:TBEo] Processing form
 * [form:a3f9|token:TBEo] Validation failed { ... }
 *
 * @param {object} fields   - The submitted form fields
 * @param {object} options  - The options object (reads tokenField)
 * @returns {{ info, warn, error, log }}
 */
export function createLogger(fields = {}, options = {}) {
  const id = Math.random().toString(36).slice(2, 6);
  const token = fields[options.tokenField];
  const prefix = token ? `[form:${id}|token:${token}]` : `[form:${id}]`;

  return {
    log:   (...args) => console.log(prefix, ...args),
    info:  (...args) => console.info(prefix, ...args),
    warn:  (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}
