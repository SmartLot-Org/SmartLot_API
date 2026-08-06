# Migraciones SQL

Aplicar los archivos por nombre, antes de desplegar el código que los consume. La API de tratos incluida en este cambio requiere `id_sede`, por lo que `20260806_...sql` debe ejecutarse antes del backend. La migración no elimina filas: los tratos que no pueden asociarse de forma inequívoca quedan con `id_sede IS NULL` como registros legacy.
