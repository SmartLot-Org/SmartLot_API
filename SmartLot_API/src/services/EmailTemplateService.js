// emailTemplateService.js
import EmailTemplateRepository from '../repos/EmailTemplateRepository.js';
import {
    renderPlantilla,
    invalidarCachePlantilla,
    enviarCorreo
} from './emailService.js';

export default class EmailTemplateService {
    constructor() {
        this.repo = new EmailTemplateRepository();
    }

    listAsync = async () => {
        return await this.repo.listAllAsync();
    }

    getAsync = async (codigo) => {
        const plantilla = await this.repo.getByCodigoAsync(codigo);
        if (!plantilla) {
            const error = new Error('Plantilla de email no encontrada.');
            error.statusCode = 404;
            throw error;
        }
        return plantilla;
    }

    /**
     * Arma las variables de ejemplo del preview a partir de los ejemplos
     * declarados en la plantilla, permitiendo sobreescribirlas desde el dashboard.
     */
    _construirVariablesPreview = (plantilla, overrides = {}) => {
        const muestras = Array.isArray(plantilla.variables) ? plantilla.variables : [];
        const mapa = {};
        for (const item of muestras) {
            if (item && typeof item === 'object' && item.variable) {
                mapa[item.variable] = item.ejemplo ?? '';
            }
        }
        return { ...mapa, ...overrides };
    }

    previewAsync = async (codigo, overrides = {}) => {
        const plantilla = await this.getAsync(codigo);
        const variables = this._construirVariablesPreview(plantilla, overrides);
        const { asunto, html } = renderPlantilla(plantilla, variables);
        return { codigo: plantilla.codigo, asunto, variables, html };
    }

    enviarPruebaAsync = async (codigo, destinatario, overrides = {}) => {
        const plantilla = await this.getAsync(codigo);
        const variables = this._construirVariablesPreview(plantilla, overrides);
        const { asunto, html } = renderPlantilla(plantilla, variables);
        return await enviarCorreo(destinatario, asunto, html);
    }

    updateAsync = async (codigo, datos) => {
        const actualizada = await this.repo.updateAsync(codigo, datos);
        if (!actualizada) {
            const error = new Error('Plantilla de email no encontrada.');
            error.statusCode = 404;
            throw error;
        }
        invalidarCachePlantilla(codigo);
        return actualizada;
    }
}