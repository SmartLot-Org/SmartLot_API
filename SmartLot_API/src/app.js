import 'dotenv/config'
import express 	from "express";
import cors 	from "cors";
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

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
import authMiddleware      from "./middlewares/authMiddleware.js"
import errorHandler       from "./middlewares/errorHandler.js"

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
});

const app  = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));

app.use("/api/empresa", authMiddleware, EmpresaController);
app.use("/api/garage", authMiddleware, GarageController);
app.use("/api/marca", authMiddleware, MarcaController);
app.use("/api/modelo", authMiddleware, ModeloController);
app.use("/api/reserva", authMiddleware, ReservaController);
app.use("/api/rol", authMiddleware, RolController);
app.use("/api/sede", authMiddleware, SedeController);
app.use("/api/usuario", UsuarioController);
app.use("/api/vehiculo", authMiddleware, VehiculoController);
app.use("/api/auth", AuthController);
app.use("/api/conflicto", authMiddleware, ConflictoController);
app.use("/api/trato-empresa-garage", authMiddleware, TratoEmpresaGarageController);
app.use("/api/solicitud-empresa-garage", authMiddleware, SolicitudEmpresaGarageController);

app.use(errorHandler);

const server = app.listen(port, () => {
    console.log("server.js");
    console.log(`Listening on http://localhost:${port}`)
});

server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});
  
