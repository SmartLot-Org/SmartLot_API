import { MercadoPagoConfig, Preference, Payment, PaymentRefund } from 'mercadopago';
import crypto from 'crypto';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

export const isSandbox = () => process.env.MP_SANDBOX === 'true' || process.env.MP_SANDBOX === '1';

const isLocalhost = (url) => {
  if (!url) return true;
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
};

const cleanUrl = (url) => {
  if (!url) return '';
  return String(url).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
};

export const createPreference = async (items, orderId, backUrls = {}, metadata = {}) => {
  const preference = new Preference(client);

  const frontendBase = cleanUrl(process.env.FRONTEND_URL) || 'http://localhost:5173';
  const defaultBackUrls = {
    success: `${frontendBase}/superadmin/pagos-test`,
    failure: `${frontendBase}/payment/failure`,
    pending: `${frontendBase}/payment/pending`
  };

  const body = {
    items: items.map(item => ({
      id: item.id || item.id_reserva || 'item',
      title: item.title || item.descripcion || 'Reserva SmartLot',
      description: item.description || '',
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price || item.monto || 0),
      currency_id: item.currency_id || 'ARS'
    })),
    external_reference: String(orderId),
    back_urls: { ...defaultBackUrls, ...backUrls }
  };
  if (Object.keys(metadata).length) body.metadata = metadata;

  const backendClean = cleanUrl(process.env.BACKEND_URL);
  if (!isLocalhost(backendClean)) {
    body.notification_url = `${backendClean}/api/payments/webhook`;
  }

  const autoReturn = String(process.env.MP_AUTO_RETURN || '').trim().replace(/^["']|["']$/g, '');
  if (autoReturn) {
    if (isLocalhost(frontendBase)) {
      console.warn('[MP] MP_AUTO_RETURN=approved configurado pero FRONTEND_URL es localhost (http://localhost:5173). Mercado Pago rechaza auto_return con localhost/http y exige https público + Checkout Pro habilitado.');
      console.warn('[MP] Se omite auto_return y se usará botón "Volver al sitio" + polling automático cada 5s (ya implementado en /superadmin/pagos-test). Para probar auto_return real usa un túnel https: ej. ngrok http 5173 y FRONTEND_URL=https://xxxx.ngrok-free.app');
      // No se envía auto_return en localhost para evitar "auto_return invalid"
    } else if (!body.back_urls?.success) {
      console.warn('[MP] MP_AUTO_RETURN activo pero back_urls.success indefinido – se omite auto_return');
    } else {
      body.auto_return = autoReturn;
    }
  }

  if (process.env.MP_SANDBOX === 'true' || process.env.NODE_ENV === 'development') {
    console.log('[MP] createPreference body:', JSON.stringify({ ...body, items: body.items?.length + ' items' }, null, 2));
  }

  try {
    const response = await preference.create({ body });
    return response;
  } catch (err) {
    const msg = JSON.stringify(err?.cause || err?.message || err).toLowerCase();
    const isAutoReturnError = msg.includes('auto_return') || msg.includes('back_url');
    if (isAutoReturnError && body.auto_return) {
      console.warn('[MP] auto_return rechazado por MP (probable localhost/http sin HTTPS o cuenta sin Checkout Pro). Reintentando sin auto_return -> usará botón "Volver al sitio".');
      console.warn('[MP] Para auto_return real necesitas FRONTEND_URL https público (ngrok) y Checkout Pro habilitado.');
      delete body.auto_return;
      if (process.env.MP_SANDBOX === 'true' || process.env.NODE_ENV === 'development') {
        console.log('[MP] reintentando createPreference sin auto_return, body:', JSON.stringify({ ...body, items: body.items?.length + ' items' }, null, 2));
      }
      const retry = await preference.create({ body });
      return retry;
    }
    // No es error de auto_return, propagar
    throw err;
  }
};

export const getPayment = async (paymentId) => {
  const payment = new Payment(client);
  try {
    return await payment.get({ id: paymentId });
  } catch (err) {
    // Normalizar errores del SDK de MP a errores con statusCode para el handler
    const status = err?.status || err?.statusCode;
    const apiErr = err?.cause || err?.error || err?.message;
    // MPNotFoundError, 404 o code 2000 = payment not found
    const isNotFound =
      status === 404 ||
      err?.name === 'MPNotFoundError' ||
      err?.error === 'not_found' ||
      err?.causes?.some?.((c) => c?.code === 2000) ||
      String(apiErr).toLowerCase().includes('not_found');

    if (isNotFound) {
      const e = new Error(`Pago ${paymentId} no encontrado en Mercado Pago`);
      e.statusCode = 404;
      e.code = 'payment_not_found';
      e.paymentId = String(paymentId);
      e.cause = err;
      throw e;
    }
    // Si el SDK trae status pero no statusCode, propagarlo
    if (status && !err.statusCode) err.statusCode = status;
    throw err;
  }
};

export const verifySignature = (req) => {
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('⚠️ MP_WEBHOOK_SECRET not configured - skipping webhook signature verification (DEV MODE)');
    return true;
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature || !xRequestId) {
    console.warn('Missing x-signature or x-request-id headers');
    return false;
  }

  const parts = xSignature.split(',');
  let ts = '';
  let hash = '';

  parts.forEach((part) => {
    const [key, value] = part.split('=');
    if (key.trim() === 'ts') ts = value.trim();
    if (key.trim() === 'v1') hash = value.trim();
  });

  if (!ts || !hash) {
    console.warn('Invalid x-signature format');
    return false;
  }

  const dataId = req.query['data.id'] || req.body?.data?.id || req.body?.id;

  if (!dataId) {
    console.warn('Missing data.id in webhook payload');
    return false;
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(manifest);
  const calculatedHash = hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash));
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

export const refundPayment = async (paymentId, amount) => {
  const refund = new PaymentRefund(client);

  const body = amount ? { amount: Number(amount) } : {};

  return await refund.create({
    payment_id: paymentId,
    body
  });
};

export const searchPayments = async (filters = {}) => {
  const payment = new Payment(client);
  const options = {};
  if (filters.external_reference) options.external_reference = filters.external_reference;
  if (filters.status) options.status = filters.status;
  if (filters.limit) options.limit = filters.limit;
  if (filters.offset) options.offset = filters.offset;
  if (filters.range?.from && filters.range?.to) {
    options.range = 'date_created';
    options.begin_date = filters.range.from;
    options.end_date = filters.range.to;
  }
  return await payment.search({ options });
};
