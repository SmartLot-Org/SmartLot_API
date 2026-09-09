import 'dotenv/config'
// Debe evaluarse antes que cualquier modulo que cree fechas (ver comentario interno)
import './config/timezone.js';
import express 	from "express";
import cors 	from "cors";
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pathToFileURL } from 'url';

import EmpresaController   from "./controllers/empresaController.js"
import GarageController    from "./controllers/garageController.js"
import MarcaController     from "./controllers/marcaController.js"
import ModeloController    from "./controllers/modeloController.js"
import ReservaController   from "./controllers/reservaController.js"
import RolController       from "./controllers/rolController.js"
import SedeController      from "./controllers/sedeController.js"
import UsuarioController   from "./controllers/usuarioController.js"
import VehiculoController  from "./controllers/vehiculoController.js"
import ConflictoController from "./controllers/ConflictoController.js"
import AuthController      from "./controllers/AuthController.js"
import TratoEmpresaGarageController from "./controllers/tratoEmpresaGarageController.js"
import SolicitudEmpresaGarageController from "./controllers/solicitudEmpresaGarageController.js"
import SolicitudRegistroController from "./controllers/solicitudRegistroController.js"
import NotificacionController from "./controllers/NotificacionController.js"
import PaymentController from "./controllers/paymentController.js"
import EmailTemplateController from "./controllers/emailTemplateController.js"
import CuentaCorrienteController from "./controllers/cuentaCorrienteController.js"
import authMiddleware      from "./middlewares/authMiddleware.js"
import errorHandler       from "./middlewares/errorHandler.js"
import { requireRole }    from "./middlewares/rolesMiddleware.js"

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

const app  = express();
const port = process.env.PORT || 3000;

// Necesario cuando TLS termina en proxy (Render/Nginx) para que
// req.secure y cookies `secure:true` funcionen correctamente
app.set('trust proxy', 1);

// HSTS + headers seguros (solo HSTS en prod para no bloquear localhost)
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    // Render ya fuerza HTTPS; en local no queremos redirecciones
}));

// Redirect http -> https en prod (cuando el proxy indica x-forwarded-proto)
app.use((req, res, next) => {
    if (isProd && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
});

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked: ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({
    limit: '10kb',
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use("/api/empresa", authMiddleware, EmpresaController);
app.use("/api/garage", authMiddleware, GarageController);
app.use("/api/marca", authMiddleware, MarcaController);
app.use("/api/modelo", authMiddleware, ModeloController);
app.use("/api/reserva", authMiddleware, ReservaController);
app.use("/api/rol", authMiddleware, RolController);
app.use("/api/sede", authMiddleware, SedeController);
app.use("/api/usuario", UsuarioController);
app.use("/api/solicitud-registro", SolicitudRegistroController);
app.use("/api/vehiculo", authMiddleware, VehiculoController);
app.use("/api/auth", AuthController);
app.use("/api/conflicto", authMiddleware, ConflictoController);
app.use("/api/trato-empresa-garage", authMiddleware, TratoEmpresaGarageController);
app.use("/api/solicitud-empresa-garage", authMiddleware, SolicitudEmpresaGarageController);
app.use("/api/notificacion", authMiddleware, NotificacionController);
app.use("/api/email-template", authMiddleware, requireRole(4), EmailTemplateController);
app.use("/api/cuentas-corrientes", authMiddleware, CuentaCorrienteController);

// Payment routes - webhook is public, others require auth
app.use("/api/payments", (req, res, next) => {
    if (req.path === '/webhook' && req.method === 'POST') {
        return next();
    }
    authMiddleware(req, res, next);
}, PaymentController);

app.use(errorHandler);

const isMainModule = !process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    const server = app.listen(port, () => {
        console.log("server.js");
        console.log(`Listening on http://localhost:${port}`)
    });

    server.on('error', (error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

export default app;
  
