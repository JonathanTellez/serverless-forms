import formidable from 'formidable';
import { sendMail } from './email.js';
import { sendHook } from './hook.js';
import { validateFields } from './validate.js';

function generateEmailBody(fields, referer, options) {
  return `
    <p>A new form submission was received from your website ${referer}</p>
    <table border="1" cellpadding="5" cellspacing="0">
        <tr><th>Field</th><th>Value</th></tr>
        ${Object
          .keys(fields)
          .filter(field => field !== options.honeyField)
          .filter(field => field !== options.siteField)
          .filter(field => field !== options.tokenField)
          .filter(field => field !== options.thanksField)
          .map(field => `<tr><td>${field}</td><td>${fields[field]}</td></tr>`)
          .join('')}
    </table>
    <p>${options.disclaimer}</p>
  `
}

// get the email addresses from the `TO` env var
// @example TO="email1@domain,email2@domain"
// @example TO="TBEoZo2EfdVFhak5:jonathantellezr@gmail.com;XyZpQrStUvWxYzab:example@email.com"
function toJsonOrString(jsonOrString) {
  try {
    
    if (typeof jsonOrString === 'string' && jsonOrString.includes(':')) {
      const toObject = jsonOrString.split(';').reduce((acc, pair) => {
        const [key, value] = pair.split(':');
        acc[key] = value;
        return acc;
      }, {});
      if (toObject) {
        return [null, toObject];
      }
    } else {
      return [jsonOrString, null];
    }
  } catch (e) {
    console.info('TO env var is not a JSON object. Using as a string.');
    return [jsonOrString, null];
  }
}

function getRecipient(fields, options) {
  const [toStr, toJson] = toJsonOrString(options.to);
  const to = toStr || toJson[fields[options.tokenField]];
  if (!to) {
    console.error('No email address found in the form', { toStr, toJson }, `Add a field named ${options.tokenField} with a value that matches one of the tokens in the TO env var`);
    throw new Error(`No email address found for token: ${fields[options.tokenField]}`);
  }
  return to
}

function getHookParsed(fields, hookJson, options) {
  if (hookJson.url && hookJson.headers) {
    // Catch all hook
    return hookJson;
  } else if (!options.tokenField) {
    return null;
  }
  const key = fields[options.tokenField];
  if (!key) {
    console.warn(`No token found in the form for field ${options.tokenField}`);
    return null;
  }
  return hookJson[key];
}

function getHook(fields, options) {
  if(!options.hook) {
    return null;
  }
  // Case of 1 hook for all forms
  try {
    if (typeof options.hook === 'string') {
      const hookJson = JSON.parse(options.hook);
      return getHookParsed(fields, hookJson, options);
    } else {
      return getHookParsed(fields, options.hook, options);
    }
  } catch(e) {
    console.error('hook option is not a JSON object', e.message, options.hook);
    throw new Error(`hook option is not a JSON object. ${e.message}`);
  }
}

function handleResponse(res, fields, options) {
  if (options.redirect === 'true' && fields[options.thanksField]) {
    res.writeHead(302, { Location: fields[options.thanksField] });
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(options.message);
  }
}

function handleError(res, err) {
  res.writeHead(500, { 'Content-Type': 'text/plain' });
  res.end(`Error: ${err.message}`);
}

export function processForm(req, res, options) {
  const form = new formidable.IncomingForm();
  const fields = {};

  form.on('field', (field, value) => {
    fields[field] = value;
  });

  form.on('end', async () => {
    try {
      const { valid, errors } = validateFields(fields, options);
      if (!valid) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Validation failed', fields: errors }));
        return;
      }
      handleForm(fields, req.headers.referer, options, JSON.stringify(req.headers));
      handleResponse(res, fields, options);
    } catch (err) {
      handleError(res, err);
    }
  });

  try {
    form.parse(req);
  } catch (err) {
    handleError(res, err);
  }
}

// Exported for testing
export async function handleForm(fields, refererHeader, options, headersString) {
  console.log('Processing form with fields:', fields);
  const referer = fields[options.siteField] || refererHeader || 'your website';
  const hook = getHook(fields, options);
  const html = generateEmailBody(fields, referer, options);
  try {
    const to = getRecipient(fields, options);
    if (fields[options.honeyField]) {
      if (hook) {
        await sendHook(html, to, headersString, hook, fields, false, 'Honey pot field was filled');
      }
      console.log('Honeypot field filled. Not sending email.');
      return;
    }
    const result = await sendMail(html, to, `New form submission on ${referer}`, options.mail);
    if (hook) {
      await sendHook(html, to, headersString, hook, fields, result.rejected.length === 0, result.response);
    }
  } catch (err) {
    if (hook) {
      await sendHook(html, to, headersString, hook, fields, false, err.message);
    }
    // throw err;
    console.error('Error sending email:', err);
  }
}
