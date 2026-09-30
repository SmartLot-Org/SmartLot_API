BEGIN;
DELETE FROM notificaciones WHERE tipo = 'solicitud_registro';
COMMIT;
