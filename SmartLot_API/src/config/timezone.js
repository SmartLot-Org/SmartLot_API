// Fija la zona horaria del proceso ANTES de crear cualquier fecha.
// Debe ser el primer import de la aplicacion.
//
// Render corre en UTC: sin esto, un horario local argentino como
// "2026-09-07 14:00:00" se interpreta como 14:00 UTC y todas las
// validaciones y franjas horarias quedan corridas 3 horas.
// La Argentina no usa horario de verano desde 2009, por lo que
// America/Argentina/Buenos_Aires es UTC-3 todo el anio.
process.env.TZ = 'America/Argentina/Buenos_Aires';
