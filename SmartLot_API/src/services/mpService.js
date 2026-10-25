import { MercadoPagoConfig, Preference, Payment, PaymentRefund, MerchantOrder } from 'mercadopago';
import crypto from 'crypto';
import { httpError } from '../helpers/httpError.js';
import { BAD_GATEWAY } from '../helpers/httpStatus.js';

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

// Los errores del SDK traen el status de Mercado Pago, no el de esta API. Reenviarlo haría
// que un 401 del proveedor se lea como sesión vencida: toda falla del proveedor es un 502.
const upstreamError = (err) => {
  console.error('[MP] Falla del proveedor:', { status: err?.status ?? err?.statusCode, error: err?.error, message: err?.message });
  return httpError('No se pudo completar la operación con Mercado Pago.', BAD_GATEWAY, { code: 'MP_UPSTREAM_ERROR', cause: err });
};

const cleanUrl = (url) => {
  if (!url) return '';
  return String(url).trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
};

export const createPreference = async (items, orderId, backUrls = {}, metadata = {}) => {
  const preference = new Preference(client);

  const frontendBase = cleanUrl(process.env.FRONTEND_URL) || 'http://localhost:5173';
  const defaultBackUrls = {
    success: `${frontendBase}/payment/success`,
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
      try {
        return await preference.create({ body });
      } catch (retryErr) {
        throw upstreamError(retryErr);
      }
    }
    // No es error de auto_return
    throw upstreamError(err);
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
    throw upstreamError(err);
  }
};

// No coercionar arrays/objetos de query o JSON al construir el manifiesto.
const webhookId = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
};

export const verifySignature = (req) => {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret?.trim()) return false;

  const xSignature = req.headers?.['x-signature'];
  const xRequestId = req.headers?.['x-request-id'];
  if (typeof xSignature !== 'string' || typeof xRequestId !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(xRequestId)) return false;

  // Mercado Pago firma data.id de la URL, nunca body.id (ID de notificación).
  const dataId = req.query?.['data.id'];
  if (typeof dataId !== 'string' || !webhookId(dataId) ||
      webhookId(req.body?.data?.id) !== dataId) return false;

  const fields = new Map();
  for (const part of xSignature.split(',')) {
    const match = /^\s*(ts|v1)=([^=,]+)\s*$/.exec(part);
    if (!match || fields.has(match[1])) return false;
    fields.set(match[1], match[2].trim());
  }
  const ts = fields.get('ts');
  const hash = fields.get('v1');
  if (!/^\d+$/.test(ts || '') || !/^[a-fA-F0-9]{64}$/.test(hash || '')) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const calculatedHash = crypto.createHmac('sha256', secret).update(manifest).digest();
  return crypto.timingSafeEqual(calculatedHash, Buffer.from(hash, 'hex'));
};

export const refundPayment = async (paymentId, amount, idempotencyKey) => {
  const refund = new PaymentRefund(client);
  const requestOptions = idempotencyKey ? { idempotencyKey } : undefined;

  try {
    if (amount === undefined) {
      return await refund.total({ payment_id: paymentId, requestOptions });
    }

    return await refund.create({
      payment_id: paymentId,
      body: { amount: Number(amount) },
      requestOptions
    });
  } catch (err) {
    throw upstreamError(err);
  }
};

export const getMerchantOrder = async (merchantOrderId) => {
  const merchantOrder = new MerchantOrder(client);
  try {
    return await merchantOrder.get({ merchantOrderId });
  } catch (err) {
    throw upstreamError(err);
  }
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
  try {
    return await payment.search({ options });
  } catch (err) {
    throw upstreamError(err);
  }
};
