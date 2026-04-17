const FORMSPREE_URL = 'https://formspree.io/f/xrerpyrr';
const ALLOWED_ORIGIN = 'https://autoads.se';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function toE164(phone) {
  const digits = phone.replace(/[\s\-\(\)\.]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('0')) return '+46' + digits.slice(1);
  if (digits.length >= 9) return '+46' + digits;
  return null;
}

async function sendSms(env, phone, contact) {
  const e164 = toE164(phone);
  if (!e164) throw new Error('Invalid phone number: ' + phone);

  const body =
    `Hej ${contact}! Tack för din anmälan till Autoads Sweden. Vi hör av oss inom 24 timmar. / Emil, 070-093 77 08`;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      },
      body: new URLSearchParams({
        To: e164,
        MessagingServiceSid: env.TWILIO_MESSAGING_SID,
        Body: body,
      }).toString(),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Twilio error: ' + err);
  }
}

async function sendEmail(data) {
  const res = await fetch(FORMSPREE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': ALLOWED_ORIGIN,
      'Referer': ALLOWED_ORIGIN + '/',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Email error: ' + err);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    let data;
    try {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await request.json();
      } else {
        const text = await request.text();
        data = Object.fromEntries(new URLSearchParams(text));
      }
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Bad request body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const contact = (data.contact || data.name || 'Kund').trim();
    const phone = (data.phone || '').trim();

    const errors = [];

    try {
      await sendEmail(data);
    } catch (err) {
      console.error('Email failed:', err.message);
      errors.push('email: ' + err.message);
    }

    if (phone) {
      try {
        await sendSms(env, phone, contact);
      } catch (err) {
        console.error('SMS failed:', err.message);
        errors.push('sms: ' + err.message);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, errors: errors.length ? errors : undefined }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  },
};
