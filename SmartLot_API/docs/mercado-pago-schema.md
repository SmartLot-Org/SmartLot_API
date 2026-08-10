/# Mercado Pago Database Schema

## Tables Required

### 1. `pagos` (Payments)
Stores payment information linked to orders/reservas.

```sql
CREATE TABLE pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_reserva UUID REFERENCES reservas(id) ON DELETE SET NULL,
    id_orden_externa VARCHAR(100), -- external_reference (orderId)
    mp_preference_id VARCHAR(100) UNIQUE,
    mp_payment_id VARCHAR(100) UNIQUE,
    mp_payment_status VARCHAR(50), -- pending, approved, rejected, cancelled, refunded
    mp_payment_type VARCHAR(50), -- credit_card, debit_card, ticket, etc.
    monto DECIMAL(12, 2) NOT NULL,
    moneda VARCHAR(3) DEFAULT 'ARS',
    descripcion TEXT,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_aprobacion TIMESTAMP WITH TIME ZONE,
    metadata JSONB, -- store full MP payment response for debugging
    id_empresa UUID REFERENCES empresas(id) ON DELETE SET NULL
);

CREATE INDEX idx_pagos_mp_preference_id ON pagos(mp_preference_id);
CREATE INDEX idx_pagos_mp_payment_id ON pagos(mp_payment_id);
CREATE INDEX idx_pagos_id_reserva ON pagos(id_reserva);
CREATE INDEX idx_pagos_id_orden_externa ON pagos(id_orden_externa);
CREATE INDEX idx_pagos_id_empresa ON pagos(id_empresa);
```

### 2. `reembolsos` (Refunds)
Tracks refunds issued for payments.

```sql
CREATE TABLE reembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_pago UUID REFERENCES pagos(id) ON DELETE CASCADE,
    mp_refund_id VARCHAR(100) UNIQUE,
    monto DECIMAL(12, 2) NOT NULL,
    moneda VARCHAR(3) DEFAULT 'ARS',
    estado VARCHAR(50), -- pending, approved, rejected
    motivo VARCHAR(255),
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX idx_reembolsos_id_pago ON reembolsos(id_pago);
CREATE INDEX idx_reembolsos_mp_refund_id ON reembolsos(mp_refund_id);
```

### 3. `webhook_eventos` (Webhook Events Log)
Audit log for all received webhook notifications (idempotency, debugging).

```sql
CREATE TABLE webhook_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mp_event_id VARCHAR(100), -- unique event ID from MP
    tipo_evento VARCHAR(100), -- payment.created, payment.updated, etc.
    mp_payment_id VARCHAR(100),
    payload JSONB NOT NULL,
    firma_valida BOOLEAN DEFAULT FALSE,
    procesado BOOLEAN DEFAULT FALSE,
    error_procesamiento TEXT,
    fecha_recepcion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_procesamiento TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_webhook_eventos_mp_event_id ON webhook_eventos(mp_event_id);
CREATE INDEX idx_webhook_eventos_mp_payment_id ON webhook_eventos(mp_payment_id);
CREATE INDEX idx_webhook_eventos_procesado ON webhook_eventos(procesado);
```

---

## Relationships

```
reservas (1) ─────< (N) pagos
pagos (1) ─────< (N) reembolsos
```

---

## Required Environment Variables

```env
# Mercado Pago
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx
MP_WEBHOOK_SECRET=<from MP Dashboard > Webhooks > Signing Secret>  # Optional for dev
MP_AUTO_RETURN=approved  # Optional. Only if Checkout Pro is activated in the account

# URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000
```

---

## Webhook Configuration (Mercado Pago Dashboard)

**URL**: `{BACKEND_URL}/api/payments/webhook`

**Events to subscribe**:
- `payment.created`
- `payment.updated`
- `payment.refunded`

---

## Payment Flow (Checkout Pro)

1. **Backend**: `POST /api/payments/preference` → Creates preference, saves `pagos` record with `mp_preference_id`
2. **Frontend**: Redirects to `init_point` from preference response
3. **User**: Pays on Mercado Pago site
4. **MP**: Redirects to `back_urls.success` with `payment_id` and `preference_id` query params
4. **Frontend**: Calls `GET /api/payments/:paymentId` to confirm status
5. **MP**: Sends webhook to `/api/payments/webhook` (async, backup confirmation)
6. **Backend**: Updates `pagos` record with `mp_payment_id`, status, approval date
7. **Frontend**: Shows success/failure page based on payment status

---

## SQL to Apply (Run in Order)

```sql
-- 1. Pagos table
CREATE TABLE pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_reserva UUID REFERENCES reservas(id) ON DELETE SET NULL,
    id_orden_externa VARCHAR(100),
    mp_preference_id VARCHAR(100) UNIQUE,
    mp_payment_id VARCHAR(100) UNIQUE,
    mp_payment_status VARCHAR(50),
    mp_payment_type VARCHAR(50),
    monto DECIMAL(12, 2) NOT NULL,
    moneda VARCHAR(3) DEFAULT 'ARS',
    descripcion TEXT,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_aprobacion TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    id_empresa UUID REFERENCES empresas(id) ON DELETE SET NULL
);

CREATE INDEX idx_pagos_mp_preference_id ON pagos(mp_preference_id);
CREATE INDEX idx_pagos_mp_payment_id ON pagos(mp_payment_id);
CREATE INDEX idx_pagos_id_reserva ON pagos(id_reserva);
CREATE INDEX idx_pagos_id_orden_externa ON pagos(id_orden_externa);
CREATE INDEX idx_pagos_id_empresa ON pagos(id_empresa);

-- 2. Reembolsos table
CREATE TABLE reembolsos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_pago UUID REFERENCES pagos(id) ON DELETE CASCADE,
    mp_refund_id VARCHAR(100) UNIQUE,
    monto DECIMAL(12, 2) NOT NULL,
    moneda VARCHAR(3) DEFAULT 'ARS',
    estado VARCHAR(50),
    motivo VARCHAR(255),
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX idx_reembolsos_id_pago ON reembolsos(id_pago);
CREATE INDEX idx_reembolsos_mp_refund_id ON reembolsos(mp_refund_id);

-- 3. Webhook eventos table
CREATE TABLE webhook_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mp_event_id VARCHAR(100),
    tipo_evento VARCHAR(100),
    mp_payment_id VARCHAR(100),
    payload JSONB NOT NULL,
    firma_valida BOOLEAN DEFAULT FALSE,
    procesado BOOLEAN DEFAULT FALSE,
    error_procesamiento TEXT,
    fecha_recepcion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_procesamiento TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_webhook_eventos_mp_event_id ON webhook_eventos(mp_event_id);
CREATE INDEX idx_webhook_eventos_mp_payment_id ON webhook_eventos(mp_payment_id);
CREATE INDEX idx_webhook_eventos_procesado ON webhook_eventos(procesado);
```