import { getEnterpriseOrderForLocal, syncEnterprisePayment } from './enterprisePaymentService.js';
import pool from '../database/db.js';
import { getPayment, searchPayments } from './mpService.js';
import { providerPaymentMatchesLocal } from './providerPaymentCorrelationService.js';

const READ_ROLES = Object.freeze({ ADMIN: 1, EMPLOYEE: 2, SUPERADMIN: 4 });
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function textOrNull(value, maxLength, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw httpError(`${field} debe ser texto.`, 400, 'invalid_filter');
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw httpError(`${field} no es valido.`, 400, 'invalid_filter');
  }
  return normalized;
}

function positiveInteger(value, fallback, field, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw httpError(`${field} debe ser un entero valido.`, 400, 'invalid_filter');
  const parsed = Number(value);
  const minimum = field === 'offset' ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > max) {
    throw httpError(`${field} esta fuera de rango.`, 400, 'invalid_filter');
  }
  return parsed;
}

function isoDateOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(`${field} debe tener formato YYYY-MM-DD.`, 400, 'invalid_filter');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw httpError(`${field} no es una fecha valida.`, 400, 'invalid_filter');
  }
  return value;
}

export function parsePaymentReadFilters(query = {}) {
  const status = textOrNull(query.status, 50, 'status');
  if (status && !/^[a-z][a-z0-9_]*$/i.test(status)) {
    throw httpError('status no es valido.', 400, 'invalid_filter');
  }
  const from = isoDateOrNull(query.from, 'from');
  const to = isoDateOrNull(query.to, 'to');
  if (from && to && from > to) throw httpError('from no puede ser posterior a to.', 400, 'invalid_filter');

  return {
    externalReference: textOrNull(query.external_reference, 100, 'external_reference'),
    preferenceId: textOrNull(query.preference_id, 100, 'preference_id'),
    status,
    from,
    to,
    limit: positiveInteger(query.limit, DEFAULT_PAGE_SIZE, 'limit', MAX_PAGE_SIZE),
    offset: positiveInteger(query.offset, 0, 'offset', 1000000)
  };
}

function accessParams(user) {
  return [
    Number(user?.id_rol),
    Number(user?.id),
    user?.id_empresa === null || user?.id_empresa === undefined ? null : Number(user.id_empresa),
    user?.id_sede === null || user?.id_sede === undefined ? null : Number(user.id_sede)
  ];
}

// La autorizacion se resuelve dentro de PostgreSQL antes de filtros, conteos y paginacion.
// Los campos de metadata solo identifican candidatos; cada consumo se vuelve a resolver
// contra consumos_reserva. Una referencia faltante, duplicada o contradictoria deja fuera el pago.
const AUTHORIZED_PAYMENTS_CTE = `
  WITH payment_context AS (
    SELECT p.*,
           r.id AS resolved_reservation_id,
           r.id_usuario AS reservation_user_id,
           u.id_empresa AS reservation_company_id,
           cr.id_sede AS reservation_consumption_site_id,
           teg.id_sede AS reservation_trato_site_id,
           COALESCE(cr.id_sede, teg.id_sede) AS reservation_site_id,
           cr.id_empresa AS reservation_consumption_company_id,
           rs.id_empresa AS reservation_site_company_id,
           (COALESCE(p.metadata, '{}'::jsonb) ? 'consumos_ids') AS grouped_metadata_present,
           jsonb_typeof(COALESCE(p.metadata, '{}'::jsonb)->'consumos_ids') AS grouped_metadata_type,
           gc.reference_count AS grouped_reference_count,
           gc.resolved_count AS grouped_resolved_count,
           gc.company_count AS grouped_company_count,
           gc.company_id AS grouped_company_id,
           gc.site_count AS grouped_site_count,
           gc.site_id AS grouped_site_id,
           gc.invalid_site_count AS grouped_invalid_site_count,
           gc.reservation_count AS grouped_reservation_count,
           gc.reservation_id AS grouped_reservation_id
      FROM pagos p
      LEFT JOIN reservas r ON r.id = p.id_reserva
      LEFT JOIN usuarios u ON u.id = r.id_usuario
      LEFT JOIN consumos_reserva cr ON cr.id_reserva = r.id
      LEFT JOIN trato_empresa_garage teg ON teg.id = r.id_trato
      LEFT JOIN sedes rs ON rs.id = COALESCE(cr.id_sede, teg.id_sede)
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS reference_count,
               COUNT(DISTINCT c.id)::integer AS resolved_count,
               COUNT(DISTINCT c.id_empresa)::integer AS company_count,
               MIN(c.id_empresa) AS company_id,
               COUNT(DISTINCT c.id_sede)::integer AS site_count,
               MIN(c.id_sede) AS site_id,
               COUNT(*) FILTER (WHERE c.id IS NOT NULL AND (gs.id IS NULL OR gs.id_empresa <> c.id_empresa))::integer AS invalid_site_count,
               COUNT(DISTINCT c.id_reserva)::integer AS reservation_count,
               MIN(c.id_reserva) AS reservation_id
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(COALESCE(p.metadata, '{}'::jsonb)->'consumos_ids') = 'array'
                THEN COALESCE(p.metadata, '{}'::jsonb)->'consumos_ids'
              ELSE '[]'::jsonb
            END
          ) AS ref(value)
          LEFT JOIN consumos_reserva c
            ON c.id = CASE
                        WHEN ref.value ~ '^[1-9][0-9]{0,18}$'
                             AND (LENGTH(ref.value) < 19 OR ref.value <= '9223372036854775807')
                          THEN ref.value::bigint
                        ELSE NULL
                      END
          LEFT JOIN sedes gs ON gs.id = c.id_sede
      ) gc ON TRUE
  ), coherent_payments AS (
    SELECT pc.*,
           CASE
             WHEN pc.id_reserva IS NOT NULL
                  AND pc.resolved_reservation_id IS NOT NULL
                  AND pc.reservation_user_id IS NOT NULL
                  AND (NOT pc.grouped_metadata_present OR pc.grouped_metadata_type = 'array')
                  AND (pc.id_empresa IS NULL OR pc.id_empresa = pc.reservation_company_id)
                  AND (pc.reservation_consumption_company_id IS NULL OR pc.reservation_consumption_company_id = pc.reservation_company_id)
                  AND (pc.reservation_site_company_id IS NULL OR pc.reservation_site_company_id = pc.reservation_company_id)
                  AND (
                    pc.reservation_consumption_site_id IS NULL
                    OR pc.reservation_trato_site_id IS NULL
                    OR pc.reservation_consumption_site_id = pc.reservation_trato_site_id
                  )
                  AND (
                    NOT (COALESCE(pc.metadata, '{}'::jsonb) ? 'id_reserva')
                    OR (
                      CASE
                        WHEN (pc.metadata->>'id_reserva') ~ '^[1-9][0-9]{0,9}$'
                             AND (
                               LENGTH(pc.metadata->>'id_reserva') < 10
                               OR (pc.metadata->>'id_reserva') <= '2147483647'
                             )
                          THEN (pc.metadata->>'id_reserva')::integer
                        ELSE NULL
                      END = pc.id_reserva
                    )
                  )
                  AND (
                    pc.grouped_reference_count = 0
                    OR (
                      pc.grouped_reference_count = pc.grouped_resolved_count
                      AND pc.grouped_reservation_count = 1
                      AND pc.grouped_reservation_id = pc.id_reserva
                    )
                  )
               THEN 'reservation'
             WHEN pc.id_reserva IS NULL
                  AND pc.grouped_metadata_type = 'array'
                  AND NOT (COALESCE(pc.metadata, '{}'::jsonb) ? 'id_reserva')
                  AND pc.grouped_reference_count > 0
                  AND pc.grouped_reference_count = pc.grouped_resolved_count
                  AND pc.grouped_company_count = 1
                  AND pc.grouped_invalid_site_count = 0
                  AND (pc.id_empresa IS NULL OR pc.id_empresa = pc.grouped_company_id)
               THEN 'grouped'
             WHEN pc.id_reserva IS NULL
                  AND NOT pc.grouped_metadata_present
                  AND NOT (COALESCE(pc.metadata, '{}'::jsonb) ? 'id_reserva')
                  AND pc.grouped_reference_count = 0
                  AND NULLIF(BTRIM(pc.mp_preference_id), '') IS NOT NULL
                  AND NULLIF(BTRIM(pc.id_orden_externa), '') IS NOT NULL
               THEN 'registered_preference'
             ELSE NULL
           END AS ownership_kind
      FROM payment_context pc
  ), authorized_payments AS (
    SELECT cp.*,
           CASE WHEN cp.ownership_kind = 'grouped' THEN cp.grouped_company_id ELSE cp.reservation_company_id END AS resolved_company_id,
           CASE WHEN cp.ownership_kind = 'grouped' THEN cp.grouped_site_id ELSE cp.reservation_site_id END AS resolved_site_id
      FROM coherent_payments cp
     WHERE cp.ownership_kind IS NOT NULL
       AND (
         $1::integer = ${READ_ROLES.SUPERADMIN}
         OR (
           $1::integer = ${READ_ROLES.ADMIN}
           AND cp.ownership_kind IN ('reservation', 'grouped')
           AND (CASE WHEN cp.ownership_kind = 'grouped' THEN cp.grouped_company_id ELSE cp.reservation_company_id END) = $3::integer
           AND (
             $4::integer IS NULL
             OR (
               CASE
                 WHEN cp.ownership_kind = 'grouped' THEN cp.grouped_site_count = 1 AND cp.grouped_site_id = $4::integer
                 ELSE cp.reservation_site_id = $4::integer
               END
             )
           )
         )
         OR (
           $1::integer = ${READ_ROLES.EMPLOYEE}
           AND cp.ownership_kind = 'reservation'
           AND cp.reservation_user_id = $2::integer
         )
       )
  )`;

function paymentColumns(alias = 'ap') {
  return `${alias}.id, ${alias}.id_reserva, ${alias}.id_orden_externa, ${alias}.mp_preference_id,
          ${alias}.mp_payment_id, ${alias}.mp_payment_status, ${alias}.mp_payment_type,
          ${alias}.monto, ${alias}.moneda, ${alias}.descripcion, ${alias}.fecha_creacion,
          ${alias}.fecha_actualizacion, ${alias}.fecha_aprobacion, ${alias}.ownership_kind,
          ${alias}.resolved_company_id, ${alias}.resolved_site_id`;
}

function listWhere(filters, params) {
  const clauses = ['ap.mp_payment_id IS NOT NULL'];
  if (filters.externalReference) {
    params.push(filters.externalReference);
    clauses.push(`ap.id_orden_externa = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`ap.mp_payment_status = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`ap.fecha_creacion >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`ap.fecha_creacion < ($${params.length}::date + INTERVAL '1 day')`);
  }
  return clauses.join(' AND ');
}

function providerValue(payment, camel, snake) {
  return payment?.[camel] ?? payment?.[snake] ?? null;
}

function redactDiagnosticError(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/\bauthorization\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, 'Authorization=[REDACTED]')
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(access[_-]?token|api[_-]?key|secret)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}

export function toPaymentResponse(source) {
  const isLocal = Object.prototype.hasOwnProperty.call(source || {}, 'mp_payment_id');
  const amount = isLocal ? source.monto : providerValue(source, 'transactionAmount', 'transaction_amount');
  return {
    id: String(isLocal ? source.mp_payment_id : source.id),
    status: isLocal ? source.mp_payment_status : source.status,
    statusDetail: isLocal ? null : providerValue(source, 'statusDetail', 'status_detail'),
    paymentType: isLocal ? source.mp_payment_type : providerValue(source, 'paymentType', 'payment_type_id'),
    transactionAmount: amount === null || amount === undefined ? null : Number(amount),
    currency: isLocal ? source.moneda : providerValue(source, 'currency', 'currency_id'),
    description: isLocal ? source.descripcion : source.description ?? null,
    dateApproved: isLocal ? source.fecha_aprobacion : providerValue(source, 'dateApproved', 'date_approved'),
    dateCreated: isLocal ? source.fecha_creacion : providerValue(source, 'dateCreated', 'date_created'),
    externalReference: isLocal ? source.id_orden_externa : providerValue(source, 'externalReference', 'external_reference'),
    preferenceId: isLocal ? source.mp_preference_id : providerValue(source, 'preferenceId', 'preference_id')
  };
}

async function authorizedReferenceCandidates(user, externalReference, preferenceId = null) {
  const params = accessParams(user);
  params.push(externalReference);
  let preferenceClause = '';
  if (preferenceId) {
    params.push(preferenceId);
    preferenceClause = ` AND ap.mp_preference_id = $${params.length}`;
  }
  const result = await pool.query(
    `/* payment_access:reference_candidates */
     ${AUTHORIZED_PAYMENTS_CTE}
     SELECT ${paymentColumns('ap')}
       FROM authorized_payments ap
      WHERE ap.id_orden_externa = $5${preferenceClause}
      ORDER BY ap.fecha_creacion DESC, ap.id DESC
      LIMIT 3`,
    params
  );
  return result.rows;
}

async function authorizedPaymentByProviderId(user, paymentId) {
  const params = accessParams(user);
  params.push(paymentId);
  const result = await pool.query(
    `/* payment_access:detail */
     ${AUTHORIZED_PAYMENTS_CTE}
     SELECT ${paymentColumns('ap')}
       FROM authorized_payments ap
      WHERE (ap.mp_payment_id = $5 OR EXISTS (
        SELECT 1 FROM enterprise_payment_attempts ea
        JOIN enterprise_payment_orders eo ON eo.reference=ea.reference
        WHERE ea.reference=ap.id_orden_externa AND eo.preference_id=ap.mp_preference_id AND ea.payment_id=$5
      ))
      LIMIT 1`,
    params
  );
  return result.rows[0] ?? null;
}

async function updateAuthorizedLocalPayment(local, payment) {
  if (await syncEnterprisePayment(payment)) return;
  const summary = {
    id: String(payment.id),
    status: payment.status ?? null,
    status_detail: payment.status_detail ?? null,
    payment_type_id: payment.payment_type_id ?? null,
    transaction_amount: payment.transaction_amount ?? null,
    currency_id: payment.currency_id ?? null,
    date_approved: payment.date_approved ?? null,
    external_reference: payment.external_reference ?? null,
    preference_id: payment.preference_id ?? local.mp_preference_id ?? null
  };
  const result = await pool.query(
    `/* payment_access:sync_authorized */
     UPDATE pagos
        SET mp_payment_id = $1,
            mp_payment_status = $2,
            mp_payment_type = $3,
            monto = COALESCE($4, monto),
            moneda = COALESCE($5, moneda),
            descripcion = COALESCE($6, descripcion),
            fecha_aprobacion = COALESCE($7, fecha_aprobacion),
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('_mp_payment_summary', $8::jsonb),
            fecha_actualizacion = NOW()
      WHERE id = $9
        AND mp_payment_id IS NOT DISTINCT FROM $12
        AND mp_preference_id IS NOT DISTINCT FROM $10
        AND id_orden_externa IS NOT DISTINCT FROM $11
      RETURNING id`,
    [
      String(payment.id),
      payment.status ?? null,
      payment.payment_type_id ?? null,
      payment.transaction_amount ?? null,
      payment.currency_id ?? null,
      payment.description ?? null,
      payment.date_approved ? new Date(payment.date_approved) : null,
      JSON.stringify(summary),
      local.id,
      local.mp_preference_id,
      local.id_orden_externa,
      local.mp_payment_id
    ]
  );
  if (result.rowCount !== 1) throw httpError('El pago local cambio durante la verificacion.', 409, 'payment_sync_conflict');
}

async function synchronizeByReference(user, filters) {
  const candidates = await authorizedReferenceCandidates(user, filters.externalReference, filters.preferenceId);
  if (candidates.length === 0) return;
  if (candidates.length > 1) {
    throw httpError('La referencia local es ambigua y requiere regularizacion.', 409, 'ambiguous_payment_reference');
  }

  const local = candidates[0];
  const enterpriseOrder = await getEnterpriseOrderForLocal(local);
  if (local.mp_payment_id && !enterpriseOrder) return;
  if (!local.mp_preference_id) {
    throw httpError('La preferencia local no permite verificar el pago.', 409, 'incomplete_payment_reference');
  }

  const providerResult = await searchPayments({ external_reference: filters.externalReference });
  const providerPayments = providerResult?.results || providerResult?.data || [];
  if (enterpriseOrder) {
    // Search puede omitir evidencia de reembolsos: verificar cada ID con Payment.
    // No elegir el primer resultado ni tratar intentos distintos como filas locales.
    const ids = new Set(Array.isArray(providerPayments) ? providerPayments.map(p => String(p.id)) : []);
    let offset = Array.isArray(providerPayments) ? providerPayments.length : 0;
    const total = Number(providerResult?.paging?.total || offset);
    while (offset < total) {
      const page = await searchPayments({ external_reference: filters.externalReference, limit: 100, offset });
      if (!Array.isArray(page?.results) || !page.results.length) {
        throw httpError('El proveedor no devolvio todos los intentos de la referencia.', 409, 'incomplete_provider_attempts');
      }
      page.results.forEach(payment => ids.add(String(payment.id)));
      offset += page.results.length;
    }
    if (enterpriseOrder.accepted_payment_id) ids.add(enterpriseOrder.accepted_payment_id);
    for (const id of ids) {
      if (!/^\d+$/.test(id)) continue;
      const payment = await getPayment(id);
      if (await providerPaymentMatchesLocal(payment, {
        id_orden_externa: local.id_orden_externa, mp_preference_id: local.mp_preference_id
      }, id)) await syncEnterprisePayment(payment);
    }
    return;
  }
  const matches = [];
  if (Array.isArray(providerPayments)) {
    for (const payment of providerPayments) {
      if (await providerPaymentMatchesLocal(payment, local)) matches.push(payment);
    }
  }
  if (matches.length === 0) return;
  if (matches.length > 1) {
    throw httpError('Mercado Pago devolvio una referencia ambigua.', 409, 'ambiguous_provider_reference');
  }
  await updateAuthorizedLocalPayment(local, matches[0]);
}

export async function listAuthorizedPayments(user, rawQuery = {}) {
  const filters = parsePaymentReadFilters(rawQuery);
  if (filters.externalReference) await synchronizeByReference(user, filters);

  const aggregateParams = accessParams(user);
  const aggregateWhere = listWhere(filters, aggregateParams);
  const aggregateResult = await pool.query(
    `/* payment_access:list_aggregate */
     ${AUTHORIZED_PAYMENTS_CTE}
     SELECT COUNT(*)::integer AS total,
            COALESCE(SUM(ap.monto), 0)::text AS total_amount
       FROM authorized_payments ap
      WHERE ${aggregateWhere}`,
    aggregateParams
  );

  const listParams = accessParams(user);
  const where = listWhere(filters, listParams);
  listParams.push(filters.limit, filters.offset);
  const listResult = await pool.query(
    `/* payment_access:list */
     ${AUTHORIZED_PAYMENTS_CTE}
     SELECT ${paymentColumns('ap')}
       FROM authorized_payments ap
      WHERE ${where}
      ORDER BY ap.fecha_creacion DESC, ap.id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const aggregate = aggregateResult.rows[0] || { total: 0, total_amount: '0' };
  return {
    results: listResult.rows.map(toPaymentResponse),
    paging: { total: Number(aggregate.total) || 0, limit: filters.limit, offset: filters.offset },
    totals: { amount: Number(aggregate.total_amount) || 0, currency: 'ARS' }
  };
}

export async function getAuthorizedPayment(user, rawPaymentId, rawQuery = {}) {
  const paymentId = String(rawPaymentId || '').trim();
  if (!/^\d+$/.test(paymentId)) {
    throw httpError('paymentId debe ser el identificador numerico de Mercado Pago.', 400, 'invalid_payment_id');
  }

  let local = await authorizedPaymentByProviderId(user, paymentId);
  let pendingLookup = false;
  if (!local) {
    const filters = parsePaymentReadFilters({
      external_reference: rawQuery.external_reference,
      preference_id: rawQuery.preference_id
    });
    if (!filters.externalReference) throw httpError('Pago no encontrado.', 404, 'payment_not_found');
    const candidates = await authorizedReferenceCandidates(user, filters.externalReference, filters.preferenceId);
    if (candidates.length !== 1 || (candidates[0].mp_payment_id && !await getEnterpriseOrderForLocal(candidates[0]))) {
      throw httpError('Pago no encontrado.', 404, 'payment_not_found');
    }
    local = candidates[0];
    pendingLookup = true;
  }

  const enterpriseOrder = await getEnterpriseOrderForLocal(local);
  const correlation = enterpriseOrder
    ? { id_orden_externa: local.id_orden_externa, mp_preference_id: local.mp_preference_id }
    : local;
  const payment = await getPayment(paymentId);
  if (!await providerPaymentMatchesLocal(payment, correlation, paymentId)) {
    throw httpError(
      pendingLookup ? 'Pago no encontrado.' : 'El proveedor devolvio referencias contradictorias para el pago local.',
      pendingLookup ? 404 : 409,
      pendingLookup ? 'payment_not_found' : 'payment_reference_conflict'
    );
  }
  await updateAuthorizedLocalPayment(local, payment);
  if (enterpriseOrder) {
    // Synchronization may have discarded this provider response as stale. Read
    // the committed financial state, scoped again to the authorized local order.
    const current = await authorizedPaymentByProviderId(user, paymentId);
    if (current && String(current.mp_payment_id) === paymentId) {
      return { payment: toPaymentResponse(current) };
    }
    const attempt = (await pool.query(`SELECT provider_snapshot FROM enterprise_payment_attempts
      WHERE payment_id=$1 AND reference=$2`, [paymentId, local.id_orden_externa])).rows[0];
    if (attempt?.provider_snapshot) return { payment: toPaymentResponse(attempt.provider_snapshot) };
  }
  return {
    payment: {
      ...toPaymentResponse(payment),
      preferenceId: local.mp_preference_id ?? null
    }
  };
}

export async function listWebhookEvents(rawQuery = {}) {
  const rawProcessed = rawQuery.procesado;
  let processed = null;
  if (rawProcessed !== undefined && rawProcessed !== '') {
    if (!['true', 'false', '1', '0'].includes(String(rawProcessed))) {
      throw httpError('procesado debe ser true, false, 1 o 0.', 400, 'invalid_filter');
    }
    processed = rawProcessed === true || rawProcessed === 'true' || rawProcessed === '1';
  }
  const limit = positiveInteger(rawQuery.limite, 100, 'limite', 100);
  const params = [];
  let where = '';
  if (processed !== null) {
    params.push(processed);
    where = `WHERE procesado = $${params.length}`;
  }
  params.push(limit);
  const result = await pool.query(
    `/* payment_access:webhook_events */
     SELECT mp_event_id, tipo_evento, mp_payment_id, firma_valida,
            procesado, error_procesamiento, fecha_recepcion, fecha_procesamiento
       FROM webhook_eventos
       ${where}
      ORDER BY fecha_recepcion DESC
      LIMIT $${params.length}`,
    params
  );
  return {
    eventos: result.rows.map((row) => ({
      ...row,
      error_procesamiento: redactDiagnosticError(row.error_procesamiento)
    }))
  };
}

export { READ_ROLES };
