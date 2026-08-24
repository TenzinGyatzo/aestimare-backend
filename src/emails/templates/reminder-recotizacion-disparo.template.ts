/**
 * Template HTML — recordatorio para volver a cotizar (equipo interno).
 * Los valores deben llegar ya escapados para HTML.
 */
export function reminderRecotizacionDisparoTemplate(params: {
  folio: string;
  nombreCliente: string;
  dashboardUrl: string;
  detalleUrl: string;
  nombreContacto?: string | null;
  telefonoContacto?: string | null;
  emailContacto?: string | null;
  fechaCreacionLabel?: string | null;
}): string {
  const {
    folio,
    nombreCliente,
    dashboardUrl,
    detalleUrl,
    nombreContacto,
    telefonoContacto,
    emailContacto,
    fechaCreacionLabel,
  } = params;

  const contactBits: string[] = [];
  if (nombreContacto) {
    contactBits.push(
      `<p style="margin: 0 0 8px; color: #374151; font-size: 15px; line-height: 1.5;">Contacto: <strong>${nombreContacto}</strong></p>`,
    );
  }
  if (telefonoContacto) {
    contactBits.push(
      `<p style="margin: 0 0 8px; color: #374151; font-size: 15px; line-height: 1.5;">Teléfono: ${telefonoContacto}</p>`,
    );
  }
  if (emailContacto) {
    contactBits.push(
      `<p style="margin: 0 0 8px; color: #374151; font-size: 15px; line-height: 1.5;">Correo: ${emailContacto}</p>`,
    );
  }
  if (fechaCreacionLabel) {
    contactBits.push(
      `<p style="margin: 0 0 8px; color: #374151; font-size: 15px; line-height: 1.5;">Cotización original: ${fechaCreacionLabel}</p>`,
    );
  }

  const contactBlock = contactBits.length
    ? `<div style="margin: 0 0 16px;">${contactBits.join('')}</div>`
    : '';

  const contactHint = nombreContacto
    ? `Contacta a <strong>${nombreContacto}</strong> para confirmar si necesita nuevamente tus productos o servicios.`
    : `Contacta a <strong>${nombreCliente}</strong> para confirmar si necesita nuevamente tus productos o servicios.`;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recordatorio para volver a cotizar · ${folio}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding: 24px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 28px;">
          <tr>
            <td>
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px;">Recordatorio para volver a cotizar</h2>
              <p style="margin: 0 0 12px; color: #374151; font-size: 15px; line-height: 1.5;">
                Es momento de contactar a <strong>${nombreCliente}</strong> para ofrecerle una nueva cotización basada en la <strong>${folio}</strong>.
              </p>
              <p style="margin: 0 0 12px; color: #374151; font-size: 15px; line-height: 1.5;">
                ${contactHint} Si está interesado, Aestimare puede ayudarte a crear una cotización nueva a partir de la original.
              </p>
              ${contactBlock}
              <p style="margin: 16px 0 0;">
                <a href="${dashboardUrl}" style="display: inline-block; background: #005bb3; color: #ffffff; font-size: 15px; text-decoration: none; padding: 10px 16px; border-radius: 6px;">Ver seguimiento en Aestimare</a>
              </p>
              <p style="margin: 12px 0 0;">
                <a href="${detalleUrl}" style="color: #2563eb; font-size: 15px; text-decoration: underline;">Volver a cotizar</a>
              </p>
              <p style="margin: 16px 0 0; color: #6b7280; font-size: 13px;">
                Este recordatorio es únicamente para tu equipo. Aestimare no ha enviado ningún mensaje al cliente.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}
