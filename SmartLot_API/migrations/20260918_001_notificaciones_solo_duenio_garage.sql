-- Solo el dueño de garage (id_rol = 5, tipo_rol = 'dueño_garage') debe recibir
-- notificaciones de sus garages. Elimina las notificaciones históricas cuyo
-- destinatario sea un garagista y normaliza el tipo de las restantes
-- (antes todas las de solicitudes usaban 'solicitud_empresa_garage').

BEGIN;

DELETE FROM notificaciones
WHERE id_usuario IN (
  SELECT u.id
  FROM usuarios u
  INNER JOIN roles r ON r.id = u.id_rol
  WHERE u.id_rol = 3 OR lower(trim(r.tipo_rol)) = 'garagista'
);

UPDATE notificaciones SET tipo = 'solicitud_enviada'
WHERE tipo = 'solicitud_empresa_garage' AND mensaje LIKE '%quiere hacer un trato%';

UPDATE notificaciones SET tipo = 'solicitud_aceptada'
WHERE tipo = 'solicitud_empresa_garage' AND mensaje LIKE '%ha aceptado la solicitud%';

UPDATE notificaciones SET tipo = 'solicitud_rechazada'
WHERE tipo = 'solicitud_empresa_garage' AND mensaje LIKE '%ha rechazado la solicitud%';

UPDATE notificaciones SET tipo = 'solicitud_cancelada'
WHERE tipo = 'solicitud_empresa_garage' AND mensaje LIKE '%ha cancelado la solicitud%';

COMMIT;
