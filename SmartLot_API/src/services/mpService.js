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

export const createPreference = async (items, orderId, backUrls = {}) => {
  const preference = new Preference(client);

  const defaultBackUrls = {
    success: `${process.env.FRONTEND_URL}/payment/success`,
    failure: `${process.env.FRONTEND_URL}/payment/failure`,
    pending: `${process.env.FRONTEND_URL}/payment/pending`
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

  if (!isLocalhost(process.env.BACKEND_URL)) {
    body.notification_url = `${process.env.BACKEND_URL}/api/payments/webhook`;
  }

  if (process.env.MP_AUTO_RETURN) {
    body.auto_return = process.env.MP_AUTO_RETURN;
  }

  const response = await preference.create({ body });
  return response;
};

export const getPayment = async (paymentId) => {
  const payment = new Payment(client);
  return await payment.get({ id: paymentId });
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