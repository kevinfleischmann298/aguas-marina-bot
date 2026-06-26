/**
 * Cliente de Supabase — Agua Marina Enterprise
 * Reemplaza los archivos .json locales por una base de datos PostgreSQL en la nube.
 * 
 * Variables de entorno requeridas:
 * - SUPABASE_URL: URL del proyecto (ej: https://xxxxx.supabase.co)
 * - SUPABASE_ANON_KEY: Clave anónima del proyecto
 */

const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

function getHeaders() {
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    };
}

function isConfigured() {
    return SUPABASE_URL && SUPABASE_KEY;
}

// ============================================================
// PEDIDOS
// ============================================================
async function guardarPedido(pedidoData) {
    if (!isConfigured()) return null;
    try {
        const res = await axios.post(`${SUPABASE_URL}/rest/v1/pedidos`, pedidoData, { headers: getHeaders() });
        console.log('✅ [SUPABASE] Pedido guardado en la nube');
        return res.data;
    } catch (err) {
        console.error('❌ [SUPABASE] Error guardando pedido:', err.message);
        return null;
    }
}

async function obtenerPedidos() {
    if (!isConfigured()) return [];
    try {
        const res = await axios.get(`${SUPABASE_URL}/rest/v1/pedidos?order=created_at.desc`, { headers: getHeaders() });
        return res.data;
    } catch (err) {
        console.error('❌ [SUPABASE] Error obteniendo pedidos:', err.message);
        return [];
    }
}

async function obtenerUltimoPedido(clienteId) {
    if (!isConfigured()) return null;
    try {
        const res = await axios.get(
            `${SUPABASE_URL}/rest/v1/pedidos?cliente_id=eq.${encodeURIComponent(clienteId)}&order=created_at.desc&limit=1`,
            { headers: getHeaders() }
        );
        return res.data.length > 0 ? res.data[0] : null;
    } catch (err) {
        console.error('❌ [SUPABASE] Error buscando último pedido:', err.message);
        return null;
    }
}

// ============================================================
// RATINGS (Calificaciones)
// ============================================================
async function guardarRating(ratingData) {
    if (!isConfigured()) return null;
    try {
        const res = await axios.post(`${SUPABASE_URL}/rest/v1/ratings`, ratingData, { headers: getHeaders() });
        console.log('✅ [SUPABASE] Rating guardado en la nube');
        return res.data;
    } catch (err) {
        console.error('❌ [SUPABASE] Error guardando rating:', err.message);
        return null;
    }
}

async function obtenerRatings() {
    if (!isConfigured()) return [];
    try {
        const res = await axios.get(`${SUPABASE_URL}/rest/v1/ratings?order=created_at.desc`, { headers: getHeaders() });
        return res.data;
    } catch (err) {
        console.error('❌ [SUPABASE] Error obteniendo ratings:', err.message);
        return [];
    }
}

// ============================================================
// CLIENTES DE CALIDAD
// ============================================================
async function guardarClienteCalidad(clienteData) {
    if (!isConfigured()) return null;
    try {
        const res = await axios.post(`${SUPABASE_URL}/rest/v1/clientes_calidad`, clienteData, { headers: getHeaders() });
        console.log('✅ [SUPABASE] Cliente calidad guardado en la nube');
        return res.data;
    } catch (err) {
        console.error('❌ [SUPABASE] Error guardando cliente calidad:', err.message);
        return null;
    }
}

module.exports = {
    isConfigured,
    guardarPedido,
    obtenerPedidos,
    obtenerUltimoPedido,
    guardarRating,
    obtenerRatings,
    guardarClienteCalidad
};
