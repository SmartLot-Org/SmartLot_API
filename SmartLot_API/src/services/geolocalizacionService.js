import axios from 'axios';
import GarageRepository from '../repositories/garageRepository.js';

const RADIO_KM = 50;
const VELOCIDAD_PROMEDIO_KMH = 40;

const haversine = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatearDistancia = (km) => {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
};

const formatearDuracion = (minutos) => {
    if (minutos < 1) return 'menos de 1 min';
    if (minutos < 60) return `${Math.round(minutos)} min`;
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    return m > 0 ? `${h} h ${m} min` : `${h} h`;
};

const calcularDistanciaGeometrica = (origenLat, origenLng, destLat, destLng) => {
    const km = haversine(origenLat, origenLng, destLat, destLng);
    const minutos = (km / VELOCIDAD_PROMEDIO_KMH) * 60;
    return {
        distanciaTexto: formatearDistancia(km),
        distanciaValor: Math.round(km * 1000),
        duracionTexto: formatearDuracion(minutos),
        duracionValor: Math.round(minutos * 60),
    };
};

export const obtenerDistanciaEntrePuntos = async (origenLat, origenLng, destLat, destLng) => {
    const apiKey = process.env.GOOGLE_MAPS_BACKEND_KEY;

    if (!apiKey) {
        return {
            ...calcularDistanciaGeometrica(origenLat, origenLng, destLat, destLng),
            origen: { lat: Number(origenLat), lng: Number(origenLng) },
            destino: { lat: Number(destLat), lng: Number(destLng) },
        };
    }

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origenLat},${origenLng}&destinations=${destLat},${destLng}&key=${apiKey}`;

    try {
        const response = await axios.get(url);
        const status = response.data?.status;
        const element = response.data?.rows?.[0]?.elements?.[0];

        const apiOk = status === 'OK' && element?.status === 'OK' && element?.distance?.value != null;

        if (apiOk) {
            return {
                distanciaTexto: element.distance.text,
                distanciaValor: element.distance.value,
                duracionTexto: element.duration.text,
                duracionValor: element.duration.value,
                origen: { lat: parseFloat(origenLat), lng: parseFloat(origenLng) },
                destino: { lat: parseFloat(destLat), lng: parseFloat(destLng) },
            };
        }

        console.warn(`Distance Matrix respondió con status "${status}", usando distancia geométrica.`);
    } catch (error) {
        console.error('Error consultando Distance Matrix:', error.message);
    }

    return {
        ...calcularDistanciaGeometrica(origenLat, origenLng, destLat, destLng),
        origen: { lat: parseFloat(origenLat), lng: parseFloat(origenLng) },
        destino: { lat: parseFloat(destLat), lng: parseFloat(destLng) },
    };
};

export const obtenerGaragesCercanosConTiempoReal = async (sedeLat, sedeLng, radioKm = RADIO_KM, sedeId = null) => {
    const repo = new GarageRepository();
    const garages = await repo.getCercanosAsync(sedeLat, sedeLng, radioKm, sedeId);

    if (!garages || garages.length === 0) {
        return [];
    }

    const conDistanciaGeometrica = () => garages.map((garage) => ({
        ...garage,
        distanciaTexto: formatearDistancia(Number(garage.distance)),
        distanciaKm: Number(garage.distance),
        tiempoConduccion: formatearDuracion((Number(garage.distance) / VELOCIDAD_PROMEDIO_KMH) * 60),
        tiempoSegundos: Math.round((Number(garage.distance) / VELOCIDAD_PROMEDIO_KMH) * 3600),
    })).sort((a, b) => Number(a.distance) - Number(b.distance));

    const apiKey = process.env.GOOGLE_MAPS_BACKEND_KEY;
    if (!apiKey) return conDistanciaGeometrica();

    try {
        const destinos = garages.map(g => `${g.latitud},${g.longitud}`).join('|');
        const origen = `${sedeLat},${sedeLng}`;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origen}&destinations=${destinos}&key=${apiKey}`;

        const response = await axios.get(url);
        const elementos = response.data?.rows?.[0]?.elements;
        if (response.data?.status !== 'OK' || !Array.isArray(elementos)) {
            return conDistanciaGeometrica();
        }

        const resultados = garages.map((garage, index) => ({
            ...garage,
            distanciaTexto: elementos[index]?.distance?.text || null,
            tiempoConduccion: elementos[index]?.duration?.text || null,
            tiempoSegundos: elementos[index]?.duration?.value || Infinity,
        }));

        return resultados.sort((a, b) => a.tiempoSegundos - b.tiempoSegundos);
    } catch {
        return conDistanciaGeometrica();
    }
};
