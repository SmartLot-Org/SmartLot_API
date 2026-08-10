# Frontend: Integración con Mercado Pago (Checkout Pro)

Guía de lo que falta construir en el frontend para completar el flujo de pago.

## Flujo completo

```
1. Usuario confirma reserva → Frontend pide preferencia al backend
2. Backend crea preferencia y devuelve init_point
3. Frontend redirige al init_point (Checkout Pro de Mercado Pago)
4. Usuario paga en el sitio de Mercado Pago
5. MP redirige a /payment/success (o /failure / /pending) con query params
6. Frontend consulta el estado real del pago: GET /api/payments/:paymentId
7. Webhook (asíncrono) actualiza el estado en la BD como respaldo
```

## Endpoints que consume el frontend

| Método | Ruta | Auth | Body / Query | Respuesta |
|--------|------|------|--------------|-----------|
| POST | `/api/payments/preference` | ✅ | `{ items: [{ id, title, unit_price, quantity }], orderId, backUrls? }` | `{ preferenceId, initPoint, sandboxInitPoint }` |
| GET | `/api/payments/:paymentId` | ✅ | — | `{ payment: { id, status, transactionAmount, ... }, saved }` |
| POST | `/api/payments/:paymentId/refund` | ✅ | `{ amount?, motivo? }` | `{ refundId, status, amount }` |
| GET | `/api/payments` | ✅ | `?external_reference=&status=&from=&to=` | lista de pagos |

## Pasos a implementar

### 1. Página de confirmación de reserva (botón "Pagar")

```js
// Al confirmar la reserva, crear la preferencia:
const res = await fetch('/api/payments/preference', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderId: String(reservaId),            // id_orden_externa
    items: [{
      id: reservaId,
      title: 'Reserva SmartLot',
      unit_price: precioTotal,             // en ARS
      quantity: 1,
    }],
    // backUrls opcional: para sobreescribir las URL de retorno
  }),
});

const { initPoint } = await res.json();
window.location.href = initPoint;         // redirigir a Checkout Pro
```

> En entorno sandbox usar `sandboxInitPoint`; en producción `initPoint`.

### 2. Rutas de retorno (back_urls)

Mercado Pago redirige a estas rutas **con query params** (el frontend de la app ya debe tenerlas o crearlas):

- `/payment/success` — pago aprobado
- `/payment/failure` — pago rechazado
- `/payment/pending` — pago pendiente (ej. efectivo)

Query params que llegan a la URL de retorno:
```
?payment_id=123456789&preference_id=pref-xyz&status=approved&external_reference=ORD-42
```

### 3. Confirmar el pago al volver (importante)

Siempre consultar el estado **real** desde el backend (nunca confiar solo en la URL):

```js
// En /payment/success?payment_id=... 
const params = new URLSearchParams(window.location.search);
const paymentId = params.get('payment_id');

const res = await fetch(`/api/payments/${paymentId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { payment } = await res.json();

if (payment.status === 'approved') {
  // marcar reserva como pagada, mostrar confirmación
} else if (payment.status === 'pending') {
  // mostrar aviso de pago pendiente
} else {
  // redirigir a /payment/failure con el motivo
}
```

**Estados posibles de `payment.status`:** `approved`, `pending`, `in_process`, `rejected`, `cancelled`, `refunded`, `charged_back`.

### 4. (Opcional) Botón de reembolso en el panel admin

```js
const res = await fetch(`/api/payments/${paymentId}/refund`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount: 500, motivo: 'Cancelación de reserva' }),
});
// Sin amount → reembolso total. Con amount → reembolso parcial.
```

### 5. Estados de UI a manejar

| Estado MP | UI |
|-----------|----|
| `approved` | Confirmación verde, reserva activa |
| `pending` | Aviso "pago pendiente de acreditación" |
| `rejected` | Error con mensaje del `status_detail` |
| `refunded` / `partially_refunded` | Alerta de reembolso |
| `cancelled` | Reserva cancelada |

## Notas / limitaciones de la cuenta actual (professor)

1. **La preferencia NO incluye `auto_return`** (el backend solo lo envía si existe la env var `MP_AUTO_RETURN`). La cuenta no tiene Checkout Pro activado → el usuario debe hacer clic en "Volver al sitio" al finalizar. Cuando el profesor active Checkout Pro, agregar `MP_AUTO_RETURN=approved` al `.env` y se redirige automáticamente.
2. **El Access Token es `APP_USR-` (producción)**: no se pueden crear pagos de prueba vía API. Para probar el checkout real, usar las **tarjetas de prueba** de Mercado Pago en el sandbox:
   - Visa: `4509 9535 6623 3704`
   - Mastercard: `5031 7557 3453 0604`
   - CVV `123`, cualquier vencimiento futuro, titular `APRO`
3. **Webhook**: no hay `MP_WEBHOOK_SECRET` → el backend acepta webhooks sin validar firma (modo dev, muestra warning). Cuando el profesor lo configure, agregar al `.env` `MP_WEBHOOK_SECRET` y la verificación HMAC se activa automáticamente.

## Checklist final

- [ ] Crear rutas `/payment/success`, `/payment/failure`, `/payment/pending` en el frontend
- [ ] Flujo: confirmar reserva → POST `/preference` → redirigir a `initPoint`
- [ ] Al volver, consultar `GET /api/payments/:paymentId` con el `payment_id` de la URL
- [ ] Mostrar estados: aprobado / pendiente / rechazado / reembolsado
- [ ] (Admin) Botón de reembolso total/parcial
- [ ] Cuando haya acceso: activar `MP_AUTO_RETURN` y `MP_WEBHOOK_SECRET` en backend
- [ ] Registrar el webhook en el dashboard de MP: `{BACKEND_URL}/api/payments/webhook` con eventos `payment.created`, `payment.updated`, `payment.refunded`