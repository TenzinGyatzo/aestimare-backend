import { DateTime } from 'luxon';
import type { RecetaRecordatorio } from './schemas/recordatorio-recotizacion.schema';
import { DEFAULT_TENANT_ZONE } from './fecha-disparo.calc';

const PRESET_LABELS: Record<string, string> = {
  '1_mes': '1 mes',
  '3_meses': '3 meses',
  '6_meses': '6 meses',
  '11_meses': '11 meses',
  '1_ano': '1 año',
  '2_anos': '2 años',
  '2_semanas_antes': '2 semanas antes de cumplir un año',
  '1_mes_antes': '1 mes antes de cumplir un año',
  '2_meses_antes': '2 meses antes de cumplir un año',
};

/** Resumen legible de la receta persistida (AD-35 / FR7). */
export function formatRecetaResumen(
  receta: Pick<RecetaRecordatorio, 'familia' | 'preset' | 'fechaExacta'>,
  fechaDisparoUtc?: Date,
  zonaHoraria?: string,
): string {
  if (receta.familia === 'fecha_exacta') {
    const raw = receta.fechaExacta ?? fechaDisparoUtc;
    if (raw) {
      const zone =
        typeof zonaHoraria === 'string' && zonaHoraria.trim()
          ? zonaHoraria.trim()
          : DEFAULT_TENANT_ZONE;
      const dt = DateTime.fromJSDate(new Date(raw), { zone: 'utc' }).setZone(
        zone,
      );
      if (dt.isValid) {
        return dt.toLocaleString(DateTime.DATE_MED, { locale: 'es' });
      }
    }
    return 'Fecha exacta';
  }
  const preset = typeof receta.preset === 'string' ? receta.preset : '';
  if (preset && PRESET_LABELS[preset]) {
    return PRESET_LABELS[preset];
  }
  return preset.replace(/_/g, ' ') || receta.familia.replace(/_/g, ' ');
}

/** Identidad AD-37: CRM live → contacto snapshot → null (sin placeholder). */
export function resolveIdentidadDisparada(
  clienteEmpresa?: string | null,
  nombreContacto?: string | null,
): string | null {
  const empresa =
    typeof clienteEmpresa === 'string' ? clienteEmpresa.trim() : '';
  if (empresa) return empresa;
  const contacto =
    typeof nombreContacto === 'string' ? nombreContacto.trim() : '';
  if (contacto) return contacto;
  return null;
}
