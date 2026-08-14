// emailTemplateController.js
// Backoffice: solo superadmin (rol 4). CRUD + preview + envío de prueba de plantillas de email.
import { Router } from 'express';
import EmailTemplateService from '../services/EmailTemplateService.js';

const router = Router();
const svc = new EmailTemplateService();

router.get('/', async (req, res) => {
    const data = await svc.listAsync();
    res.status(200).json(data);
});

router.get('/:codigo', async (req, res) => {
    const plantilla = await svc.getAsync(req.params.codigo);
    res.status(200).json(plantilla);
});

router.get('/:codigo/preview', async (req, res) => {
    const preview = await svc.previewAsync(req.params.codigo, { ...req.query });
    res.status(200).json(preview);
});

router.post('/:codigo/test', async (req, res) => {
    const { destinatario, variables } = req.body ?? {};
    const to = destinatario || req.usuario.email;
    const result = await svc.enviarPruebaAsync(req.params.codigo, to, variables ?? {});
    res.status(200).json({ success: true, messageId: result.messageId, destinatario: to });
});

router.put('/:codigo', async (req, res) => {
    const { nombre, descripcion, asunto, header_html, cuerpo_html, footer_html, variables, activa } = req.body ?? {};
    if (!asunto || !cuerpo_html) {
        return res.status(400).json({
            error: true, message: 'asunto y cuerpo_html son obligatorios.', statusCode: 400
        });
    }
    const plantilla = await svc.updateAsync(req.params.codigo, {
        nombre, descripcion, asunto, header_html, cuerpo_html, footer_html, variables, activa
    });
    res.status(200).json(plantilla);
});

export default router;