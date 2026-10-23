import { randomInt } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../database/db.js';
import RecoveryRepository from '../repositories/recoveryRepository.js';
import { enviarCorreoDesdePlantilla } from './emailService.js';
import { RECOVERY_POLICY, RECOVERY_MESSAGE, INVALID_RECOVERY_MESSAGE } from '../config/recoveryPolicy.js';

const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12',10);
const invalid = (statusCode) => Object.assign(new Error(INVALID_RECOVERY_MESSAGE), { statusCode });
const validEmail = email => typeof email === 'string' && email.includes('@');
const validCode = code => typeof code === 'string' && /^\d{6}$/.test(code);

export default class RecoveryService {
    repo = new RecoveryRepository();

    transaction = async (operation) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    };

    request = async (email) => {
        const response = { message: RECOVERY_MESSAGE, retry_after: RECOVERY_POLICY.cooldownSeconds };
        if (!validEmail(email)) return response;
        const delivery = await this.transaction(async client => {
            const user = await this.repo.lockUser(email.trim().toLowerCase(),client);
            if (!user || user.activo === false || !await this.repo.canIssue(user.id,client)) return null;
            const code = randomInt(100000,1000000).toString();
            await this.repo.issue(user.id,await bcrypt.hash(code,rounds),client);
            return { user, code };
        });
        if (delivery) {
            const { user, code } = delivery;
            // El envio sucede despues del commit; nunca dentro de una transaccion abierta.
            try {
                await enviarCorreoDesdePlantilla(user.email,'recuperar_contraseña',{
                    nombre: `${user.nombre ?? ''} ${user.apellido ?? ''}`.trim() || 'Usuario', codigo: code
                });
            } catch {
                // No filtrar la existencia de la cuenta ni datos del transporte (codigo/secretos).
                console.error('No se pudo enviar el correo de recuperacion.');
            }
        }
        return response;
    };

    use = async (email, code, operation, statusCode) => {
        if (!validEmail(email) || !validCode(code)) throw invalid(statusCode);
        const result = await this.transaction(async client => {
            // Orden unico de bloqueos: usuario, luego codigo. Emision y ambos consumos lo comparten.
            const user = await this.repo.lockUser(email.trim().toLowerCase(),client);
            if (!user || user.activo === false) return null;
            const record = await this.repo.lockCode(user.id,client);
            if (!record) return null;
            if (!await bcrypt.compare(code,record.codigo_hash)) {
                await this.repo.fail(record.id,client);
                return null; // El error esperado se lanza DESPUES del COMMIT del contador.
            }
            if (!await this.repo.consume(record.id,client)) return null;
            return operation(user,client);
        });
        if (!result) throw invalid(statusCode);
        return result;
    };

    login = async (email, code) => this.use(email,code,async (user,client) => {
        const { contraseña, ...publicUser } = user;
        const payload = { id:user.id,email:user.email,id_rol:user.id_rol,id_empresa:user.id_empresa,
            id_sede:user.id_sede,token_version:user.token_version,
            ...(user.id_garage != null ? { id_garage:user.id_garage } : {}) };
        const access = jwt.sign(payload,process.env.JWT_SECRET,{ algorithm:'HS256',expiresIn:process.env.JWT_EXPIRES_IN || '15m' });
        const refresh = jwt.sign({id:user.id,token_version:user.token_version,type:'refresh'},
            process.env.JWT_REFRESH_SECRET,{ algorithm:'HS256',expiresIn:process.env.JWT_REFRESH_EXPIRES_IN || '30d' });
        const session = await this.repo.createSession(user,refresh,new Date(Date.now()+30*24*60*60*1000),client);
        return { usuario:publicUser,access_token:access,refresh_session_id:session,token_type:'Bearer',
            expires_in:process.env.JWT_EXPIRES_IN || '15m' };
    },401);

    reset = async (email, code, password) => {
        if (typeof password !== 'string' || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
            throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres, mayúsculas, minúsculas y números.'),{statusCode:400});
        }
        const user = await this.use(email,code,async (user,client) => {
            await this.repo.resetPassword(user.id,await bcrypt.hash(password,rounds),client);
            return user;
        },400);
        try {
            await enviarCorreoDesdePlantilla(user.email,'cambio_contraseña',{
                nombre: `${user.nombre ?? ''} ${user.apellido ?? ''}`.trim() || 'Usuario'
            });
        } catch { console.error('No se pudo enviar la confirmacion de cambio de clave.'); }
        return { message:'Contraseña restablecida exitosamente.' };
    };
}
