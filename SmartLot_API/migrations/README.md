# Migraciones SQL

Aplicar los archivos por nombre, antes de desplegar el código que los consume. La API de tratos incluida en este cambio requiere `id_sede`, por lo que `20260806_...sql` debe ejecutarse antes del backend. La migración no elimina filas: los tratos que no pueden asociarse de forma inequívoca quedan con `id_sede IS NULL` como registros legacy.

`20260807_001_remove_id_sede_from_garages.sql` refleja la migración remota `remove_id_sede_from_garages`: elimina únicamente la FK y la columna `garages.id_sede`, sin `CASCADE` ni borrado de registros. No debe reaplicarse manualmente en el proyecto remoto que ya registra esa migración.

`20260828_001_consumos_reserva.sql` documenta y crea de forma idempotente el historial de consumos separado de pagos. No rellena reservas antiguas con precios actuales: ejecutar `npm run check:consumos` y resolver cualquier ID informado sólo con una tarifa histórica verificable.

`20260918_001_notificaciones_solo_duenio_garage.sql` elimina las notificaciones históricas cuyo destinatario sea garagista (id_rol = 3) y normaliza el tipo de las notificaciones de solicitudes restantes. Aplicar antes de desplegar el código que filtra a los destinatarios por rol `dueño_garage`.

`20260918_002_trato_empresa_garage_soft_delete.sql` agrega `"Borrado"` a `trato_empresa_garage` y convierte `uq_trato_sede_garage` en índice único parcial. Necesario antes de desplegar la cancelación lógica de tratos: la FK `consumos_reserva_id_trato_fkey` impide el DELETE físico cuando el trato ya tiene consumos.

`20260923_001_reservas_qr_salida.sql` agrega el token de salida, crea uno para las reservas confirmadas que ya ingresaron y siguen dentro, y exige que sea distinto del token de ingreso. Aplicar antes de desplegar los endpoints QR actualizados.
