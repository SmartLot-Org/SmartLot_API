import { RECOVERY_POLICY as policy } from '../config/recoveryPolicy.js';

// Estos metodos requieren el cliente de la transaccion, nunca usan pool.query.
export default class RecoveryRepository {
    lockUser = async (email, client) => (await client.query(`SELECT u.*,r.tipo_rol,
        CASE WHEN lower(r.tipo_rol) IN ('garagista','dueño_garage') THEN garages.id_garage ELSE NULL END AS id_garage,
        CASE WHEN lower(r.tipo_rol) IN ('garagista','dueño_garage') THEN COALESCE(garages.id_garages,'{}'::int[])
          ELSE '{}'::int[] END AS id_garages
        FROM usuarios u LEFT JOIN roles r ON r.id=u.id_rol
        LEFT JOIN LATERAL (SELECT MIN(ug.id_garage) AS id_garage,
          ARRAY_AGG(DISTINCT ug.id_garage ORDER BY ug.id_garage) AS id_garages
          FROM usuario_garage ug WHERE ug.id_usuario=u.id) garages ON true
        WHERE u.email=$1 AND COALESCE(u."Borrado",false)=false FOR UPDATE OF u`, [email])).rows[0];

    canIssue = async (id, client) => (await client.query(`SELECT
        count(*) < $2::int AND COALESCE(max(creado_en) <= clock_timestamp()-make_interval(secs=>$3::int),true) AS allowed
        FROM password_reset_codes WHERE id_usuario=$1
        AND creado_en>clock_timestamp()-make_interval(secs=>$4::int)`,
    [id, policy.maxIssuances, policy.cooldownSeconds, policy.issuanceWindowSeconds])).rows[0].allowed;

    issue = async (id, hash, client) => {
        await client.query('UPDATE password_reset_codes SET usado=true WHERE id_usuario=$1 AND usado=false', [id]);
        await client.query(`INSERT INTO password_reset_codes(id_usuario,codigo_hash,expires_at,creado_en)
            VALUES($1,$2,clock_timestamp()+make_interval(secs=>$3::int),clock_timestamp())`,
        [id, hash, policy.lifetimeSeconds]);
    };

    lockCode = async (id, client) => (await client.query(`SELECT id,codigo_hash FROM password_reset_codes
        WHERE id_usuario=$1 AND usado=false AND failed_attempts<$2
        AND expires_at>clock_timestamp() ORDER BY creado_en DESC,id DESC LIMIT 1 FOR UPDATE`,
    [id, policy.maxFailures])).rows[0];

    fail = async (id, client) => {
        await client.query(`UPDATE password_reset_codes SET failed_attempts=failed_attempts+1,
            usado=(failed_attempts+1 >= $2) WHERE id=$1 AND usado=false AND failed_attempts<$2
            AND expires_at>clock_timestamp()`, [id, policy.maxFailures]);
    };

    consume = async (id, client) => (await client.query(`UPDATE password_reset_codes SET usado=true
        WHERE id=$1 AND usado=false AND failed_attempts<$2 AND expires_at>clock_timestamp() RETURNING id`,
    [id, policy.maxFailures])).rows.length === 1;

    createSession = async (user, token, expiresAt, client) => (await client.query(`INSERT INTO refresh_sessions
        (usuario_id,token_version,refresh_token,expires_at) VALUES($1,$2,$3,$4) RETURNING id`,
    [user.id,user.token_version,token,expiresAt])).rows[0].id;

    resetPassword = async (id, hash, client) => {
        const result = await client.query(`UPDATE usuarios SET contraseña=$1,token_version=token_version+1,
            "UpdateBy"=$2,"UpdateAt"=clock_timestamp() WHERE id=$2 AND COALESCE("Borrado",false)=false
            RETURNING id`, [hash,id]);
        if (result.rows.length !== 1) throw new Error('No se pudo completar el restablecimiento');
        await client.query('DELETE FROM refresh_sessions WHERE usuario_id=$1', [id]);
    };
}
