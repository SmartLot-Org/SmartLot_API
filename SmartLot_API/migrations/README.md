# Migraciones SQL

Aplicar los archivos por nombre, antes de desplegar el código que los consume. La API de tratos incluida en este cambio requiere `id_sede`, por lo que `20260806_...sql` debe ejecutarse antes del backend. La migración no elimina filas: los tratos que no pueden asociarse de forma inequívoca quedan con `id_sede IS NULL` como registros legacy.

`20260807_001_remove_id_sede_from_garages.sql` refleja la migración remota `remove_id_sede_from_garages`: elimina únicamente la FK y la columna `garages.id_sede`, sin `CASCADE` ni borrado de registros. No debe reaplicarse manualmente en el proyecto remoto que ya registra esa migración.
