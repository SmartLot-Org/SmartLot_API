import { createClient } from '@supabase/supabase-js';
import { Agent, fetch as undiciFetch } from 'undici';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
}

// Solo en dev: hay intercepción TLS local (antivirus/proxy) que inyecta un
// cert self-signed en la cadena y Node rechaza el fetch a *.supabase.co
// (SELF_SIGNED_CERT_IN_CHAIN). En producción se usa el fetch por defecto.
const isProd = process.env.NODE_ENV === 'production';
const devFetch = isProd
  ? undefined
  : (url, options = {}) =>
      undiciFetch(url, {
        ...options,
        dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
      });

export let supabaseAdmin;

try {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    ...(devFetch ? { global: { fetch: devFetch } } : {}),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
} catch (error) {
  console.error('Error al crear cliente Supabase:', error);
  supabaseAdmin = null;
}
