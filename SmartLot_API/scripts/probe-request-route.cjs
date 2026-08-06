require('dotenv').config();
const jwt = require('jsonwebtoken');

(async () => {
    for (const id of [81, 83, 87, 88, 95]) {
        const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2m' });
        for (const endpoint of ['/api/solicitud-empresa-garage', '/api/trato-empresa-garage']) {
            const response = await fetch(`http://localhost:3000${endpoint}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                // Cantidad inválida: comprueba autenticación y autorización sin insertar.
                body: JSON.stringify({ id_garage: 21, cantidad_cocheras: 0 }),
            });
            const body = await response.json();
            console.log(JSON.stringify({ id, endpoint, status: response.status, message: body.message }));
            if (response.status === 403) process.exitCode = 1;
        }
    }

    const superToken = jwt.sign({ id: 56 }, process.env.JWT_SECRET, { expiresIn: '2m' });
    const impersonate = await fetch('http://localhost:3000/api/usuario/impersonate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 81 }),
    });
    const cookie = impersonate.headers.getSetCookie().find((value) => value.startsWith('access_token='));
    const impersonatedToken = cookie?.split(';')[0].slice('access_token='.length);
    const claims = jwt.verify(impersonatedToken, process.env.JWT_SECRET);
    console.log(JSON.stringify({ impersonate: impersonate.status, token_user: claims.id, impersonated_by: claims.impersonated_by }));

    const stop = await fetch('http://localhost:3000/api/usuario/stop-impersonate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${impersonatedToken}` },
    });
    const restored = await stop.json();
    console.log(JSON.stringify({ stop: stop.status, restored_user: restored.usuario?.id }));
    if (impersonate.status !== 200 || claims.id !== 81 || claims.impersonated_by !== 56 || stop.status !== 200 || restored.usuario?.id !== 56) process.exitCode = 1;
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
